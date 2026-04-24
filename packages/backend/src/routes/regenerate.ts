/**
 * regenerate.ts — Phase 2.3
 *
 * POST /api/regenerate
 * Re-runs rebuttal generation with an optional tone_override or strategy_override.
 * Returns a FormattedResponse. Used by the frontend ToneSwitcher.
 */

import type { FastifyInstance } from "fastify";
import {
  generateRebuttals,
  type AnalysisPayload,
} from "../services/responseGenerator.js";
import {
  formatResponse,
  type FormattedResponse,
} from "../services/responseFormatter.js";
import { resolveToneModeForPlan } from "../services/toneAccess.js";
import {
  assertGenerationBurstAllowance,
  assertUsageAllowance,
  incrementUsageCount,
  isPlanEnforcementError,
  resolveGenerationBurstKey,
  resolveRequestPlanContext,
} from "../services/planEnforcement.js";

type RegenerateBody = {
  raw_input: string;
  category?: string;
  intent?: string;
  emotional_tone?: string;
  urgency?: string;
  confidence?: number;
  signals?: string[];
  tone_override?: string;
  strategy_override?: string;
  session_id?: string;
};

export async function regenerateRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: RegenerateBody }>(
    "/api/regenerate",
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
          "regenerate: advanced tone accepted"
        );
      } else if (resolvedTone.downgraded) {
        fastify.log.info(
          {
            planType,
            requestedTone: resolvedTone.requested,
            fallbackTone: resolvedTone.tone,
          },
          "regenerate: advanced tone downgraded"
        );
      }
      if (entitlements.priorityGeneration) {
        fastify.log.info({ planType }, "regenerate: priority generation enabled");
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

      const rebuttals = await generateRebuttals(payload, {
        variantCount,
        priorityGeneration: entitlements.priorityGeneration,
        planType,
        conversationId: body.session_id ?? null,
      });

      await incrementUsageCount(fastify.supabase, context.user.id);

      const formatted: FormattedResponse = formatResponse(rebuttals, payload, {
        mode: "suggestion",
        session_id: body.session_id,
        variantCount,
      });

      try {
        const [r1, r2, r3] = rebuttals.rebuttals;
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
            rebuttals_json: rebuttals as unknown as object,
            confidence: payload.confidence ?? null,
          },
        });
      } catch (dbErr) {
        fastify.log.error({ err: dbErr }, "regenerate: failed to persist rebuttal to DB");
      }

      return reply.send(formatted);
    }
  );
}
