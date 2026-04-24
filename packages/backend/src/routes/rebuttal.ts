/**
 * rebuttal.ts — Phase 2.3 (updated from 2.2)
 *
 * POST /api/rebuttal
 * Accepts an analysis payload (from Phase 2.1 pipeline or manual call).
 * Returns a FormattedResponse (3 ranked rebuttals + delivery metadata).
 * Persists every generated rebuttal set to PostgreSQL via Prisma.
 */

import type { FastifyInstance } from "fastify";
import {
  generateRebuttals,
  type AnalysisPayload,
} from "../services/responseGenerator.js";
import { formatResponse } from "../services/responseFormatter.js";
import { resolveToneModeForPlan } from "../services/toneAccess.js";
import {
  assertGenerationBurstAllowance,
  assertUsageAllowance,
  incrementUsageCount,
  isPlanEnforcementError,
  resolveGenerationBurstKey,
  resolveRequestPlanContext,
} from "../services/planEnforcement.js";

export async function rebuttalRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: AnalysisPayload & { tone_override?: string } }>(
    "/api/rebuttal",
    async (request, reply) => {
      const body = request.body;

      if (!body?.raw_input || typeof body.raw_input !== "string") {
        return reply.status(400).send({
          error: "Invalid request",
          message: "raw_input must be a non-empty string",
        });
      }

      const context = await resolveRequestPlanContext(
        fastify.supabase,
        request.headers.authorization
      );

      try {
        assertGenerationBurstAllowance(
          resolveGenerationBurstKey(context?.user.id ?? null, request)
        );
        if (!context) {
          return reply.status(401).send({
            code: "AUTH_REQUIRED",
            message: "Authentication required",
          });
        }
        await assertUsageAllowance(fastify.supabase, context);
      } catch (err) {
        if (isPlanEnforcementError(err)) {
          return reply
            .status(err.statusCode)
            .send({ code: err.code, message: err.message });
        }
        throw err;
      }

      const { planType, entitlements } = context;
      const resolvedTone = resolveToneModeForPlan(body.tone_override, planType);
      if (resolvedTone.acceptedAdvanced && resolvedTone.tone) {
        fastify.log.info(
          { planType, tone: resolvedTone.tone },
          "rebuttal: advanced tone accepted"
        );
      } else if (resolvedTone.downgraded) {
        fastify.log.info(
          {
            planType,
            requestedTone: resolvedTone.requested,
            fallbackTone: resolvedTone.tone,
          },
          "rebuttal: advanced tone downgraded"
        );
      }
      if (entitlements.priorityGeneration) {
        fastify.log.info({ planType }, "rebuttal: priority generation enabled");
      }

      const payload: AnalysisPayload = {
        raw_input: body.raw_input.trim(),
        category: body.category ?? "other",
        intent: body.intent,
        emotional_tone: body.emotional_tone,
        urgency: body.urgency,
        confidence: body.confidence,
        signals: body.signals,
        tone_override: resolvedTone.tone,
      };

      const variantCount = entitlements.responseVariants;

      const output = await generateRebuttals(payload, {
        variantCount,
        priorityGeneration: entitlements.priorityGeneration,
        planType,
      });

      await incrementUsageCount(fastify.supabase, context.user.id);

      try {
        const [r1, r2, r3] = output.rebuttals;
        await fastify.prisma.rebuttal.create({
          data: {
            raw_input: payload.raw_input,
            category: payload.category,
            intent: payload.intent ?? null,
            emotional_tone: payload.emotional_tone ?? null,
            urgency: payload.urgency ?? null,
            rebuttal_1: r1?.text ?? "",
            rebuttal_2: r2?.text ?? "",
            rebuttal_3: r3?.text ?? "",
            rebuttals_json: output as unknown as object,
            confidence: payload.confidence ?? null,
          },
        });
      } catch (dbErr) {
        fastify.log.error({ err: dbErr }, "Failed to persist rebuttal to DB");
      }

      return reply.send(
        formatResponse(output, payload, {
          mode: "suggestion",
          variantCount,
        })
      );
    }
  );
}
