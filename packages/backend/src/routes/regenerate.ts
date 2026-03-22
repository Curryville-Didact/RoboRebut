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

      const payload: AnalysisPayload = {
        raw_input: body.raw_input.trim(),
        category: body.category ?? "other",
        intent: body.intent,
        emotional_tone: body.emotional_tone,
        urgency: body.urgency,
        confidence: body.confidence,
        signals: body.signals,
        tone_override: body.tone_override,
      };

      // Generate rebuttals via Claude (with tone_override baked into prompt)
      const rebuttals = await generateRebuttals(payload);

      // Format into structured delivery package
      const formatted: FormattedResponse = formatResponse(rebuttals, payload, {
        mode: "suggestion",
        session_id: body.session_id,
      });

      // Persist best-effort — never fail the request on DB error
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
