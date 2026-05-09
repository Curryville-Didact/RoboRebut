/**
 * Fastify app bootstrap.
 *
 * PRODUCTION live coaching: `POST /api/messages` → `coachChatReply` (see `routes/messages.ts`).
 *
 * NON-PRODUCTION: `GET /ws` handler below runs `runObjectionPipeline` + `responseGenerator` for
 * demos/integration tests — no Supabase thread, no pattern tables, hard-coded free-tier variants.
 * Keep Phase 4.+(production) work off this path.
 */

import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import cron from "node-cron";
import type { FastifyInstance, FastifyRequest } from "fastify";
import config from "./config.js";
import prismaPlugin from "./plugins/prisma.js";
import redisPlugin from "./plugins/redis.js";
import websocketPlugin from "./plugins/websocket.js";
import supabaseAuthPlugin from "./plugins/supabaseAuth.js";
import { runObjectionPipeline } from "./lib/runObjectionPipeline.js";
import { rebuttalRoutes } from "./routes/rebuttal.js";
import { regenerateRoutes } from "./routes/regenerate.js";
import { conversationRoutes } from "./routes/conversations.js";
import { billingRoutes } from "./routes/billing.js";
import { messageRoutes } from "./routes/messages.js";
import { coachLiveWsRoutes } from "./routes/coachLiveWs.js";
import { usageRoutes } from "./routes/usage.js";
import { savedResponseRoutes } from "./routes/savedResponses.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { rebuttalIntelRoutes } from "./routes/rebuttalIntel.js";
import { adminIntelligenceRoutes } from "./routes/adminIntelligence.js";
import { integrationsRoutes } from "./routes/integrations.js";
import { founderSupportRoutes } from "./routes/founderSupport.js";
import { founderAnalyticsRoutes } from "./routes/founderAnalytics.js";
import { founderOperationsRoutes } from "./routes/founderOperations.js";
import { callsRoutes } from "./routes/calls.js";
import { callWebhookRoutes } from "./routes/callWebhook.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { phrasePatternsRoutes } from "./routes/phrasePatternsRoutes.js";
import { transcriptsRoutes } from "./routes/transcripts.js";
import hubspot from "./routes/hubspot.js";
import crmConnections from "./routes/crmConnections.js";
import { runPhrasePatternAgent } from "./services/phrasePatternAgent.js";
import { generateRebuttals } from "./services/responseGenerator.js";
import { formatResponse } from "./services/responseFormatter.js";
import { getResponseVariantCountForPlan } from "./services/responseVariants.js";
import { initSentry, Sentry } from "./lib/sentry.js";
import { entitlementReconciliationQueue } from "./lib/queues.js";

initSentry();

// railway deploy trigger: founder operations route rollout

export async function createServer(): Promise<FastifyInstance> {
  const app = Fastify({
    genReqId: () => randomUUID(),
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      transport:
        process.env.NODE_ENV === "production"
          ? undefined
          : {
              target: "pino-pretty",
              options: { colorize: true, translateTime: "SYS:standard" },
            },
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url,
            requestId: request.id,
          };
        },
        res(reply) {
          return {
            statusCode: reply.statusCode,
          };
        },
      },
    },
  });

  app.decorate("config", config);

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        return cb(null, true);
      }
      if (config.corsAllowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      app.log.warn({ origin }, "CORS: origin not allowed");
      return cb(null, false);
    },
    credentials: true,
  });

  await app.register(supabaseAuthPlugin);
  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  await app.register(websocketPlugin);
  await app.register(multipart, { limits: { fileSize: 26_214_400 } });

  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: "1 minute",
    redis: app.redis,
    hook: "preHandler",
    keyGenerator: (request: FastifyRequest) => {
      const userId = request.user?.id;
      return userId ?? request.ip;
    },
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: `Rate limit exceeded. Try again in ${context.after}.`,
      retryAfter: context.after,
    }),
    addHeaders: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
      "retry-after": true,
    },
  });

  // Correlation ID — propagate request ID through all log calls
  app.addHook("onRequest", async (request) => {
    request.log.info(
      { requestId: request.id, path: request.url, method: request.method },
      "incoming request"
    );
  });

  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      {
        requestId: request.id,
        path: request.url,
        method: request.method,
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
      },
      "request completed"
    );
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (reply.sent) {
      return;
    }

    let statusCode = 500;
    let errMessage = "Internal Server Error";
    let errName = "Error";

    if (error instanceof Error) {
      errName = error.name;
      errMessage = error.message;
      const code = (error as Error & { statusCode?: number }).statusCode;
      if (typeof code === "number" && code >= 400) {
        statusCode = code;
      }
    } else if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error
    ) {
      const o = error as {
        statusCode?: number;
        message?: string;
        error?: string;
      };
      if (typeof o.statusCode === "number" && o.statusCode >= 400) {
        statusCode = o.statusCode;
      }
      if (typeof o.message === "string") {
        errMessage = o.message;
      }
      if (typeof o.error === "string") {
        errName = o.error;
      }
    }

    request.log.error(
      {
        requestId: request.id,
        err: {
          message: errMessage,
          stack:
            process.env.NODE_ENV === "production" ? undefined : error instanceof Error
              ? error.stack
              : undefined,
          code: error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined,
        },
        path: request.url,
        method: request.method,
      },
      "request error"
    );

    if (statusCode >= 500 && process.env.SENTRY_DSN?.trim()) {
      const capture =
        error instanceof Error ? error : new Error(errMessage || String(error));
      Sentry.captureException(capture, {
        extra: {
          requestId: request.id,
          path: request.url,
          method: request.method,
        },
      });
    }

    const clientMessage =
      statusCode >= 500 ? "An internal error occurred" : errMessage;

    return reply.code(statusCode).send({
      statusCode,
      error: errName || "Error",
      message: clientMessage,
      requestId: request.id,
    });
  });

  // Rate limit overrides are set per-route via:
  // config: { rateLimit: { max: N, timeWindow: 'X' } }
  // Applied in the route file's options object.

  app.get(
    "/health",
    { config: { rateLimit: false } },
    async () => ({ ok: true })
  );

  await app.register(rebuttalRoutes);
  await app.register(regenerateRoutes);
  await app.register(conversationRoutes, { prefix: "/api" });
  await app.register(billingRoutes, { prefix: "/api" });
  await app.register(messageRoutes, { prefix: "/api" });
  await app.register(coachLiveWsRoutes, { prefix: "/api" });
  await app.register(usageRoutes, { prefix: "/api" });
  await app.register(savedResponseRoutes, { prefix: "/api" });
  await app.register(analyticsRoutes, { prefix: "/api" });
  await app.register(rebuttalIntelRoutes, { prefix: "/api" });
  await app.register(adminIntelligenceRoutes, { prefix: "/api" });
  await app.register(integrationsRoutes, { prefix: "/api" });
  await app.register(founderSupportRoutes, { prefix: "/api" });
  await app.register(founderAnalyticsRoutes, { prefix: "/api" });
  await app.register(founderOperationsRoutes, { prefix: "/api" });
  await app.register(callsRoutes, { prefix: "/api" });
  await app.register(callWebhookRoutes, { prefix: "/api" });
  await app.register(workspaceRoutes, { prefix: "/api" });
  await app.register(transcriptsRoutes, { prefix: "/api" });
  await app.register(phrasePatternsRoutes, { prefix: "/api" });
  await app.register(hubspot, { prefix: "/api" });
  await app.register(crmConnections, { prefix: "/api" });

  app.get(
    "/api/me",
    {
      preHandler: (await import("./lib/auth.js")).requireAuth,
    },
    async (request) => {
      return {
        userId: request.userId,
        workspaceId: request.workspaceId,
      };
    }
  );

  // --- Demo / support WebSocket (NOT the dashboard conversation thread) ---
  app.get("/ws", { websocket: true }, (socket) => {
    socket.send(
      JSON.stringify({
        type: "connected",
        message: "RoboRebut websocket connected",
      })
    );

    socket.on("close", () => {
      // connection closed
    });

    socket.on("message", async (raw: Buffer) => {
      try {
        const message = raw.toString();

        socket.send(
          JSON.stringify({
            type: "received",
            message,
          })
        );

        // Demo path: `runObjectionPipeline` + ranked rebuttals — not `coachChatReply`
        const result = await runObjectionPipeline({ message });

        socket.send(
          JSON.stringify({
            type: "analysis",
            data: result,
          })
        );

        // Phase 2.2 — generate ranked rebuttals from the analysis
        socket.send(
          JSON.stringify({
            type: "generating_rebuttals",
            message: "Generating ranked rebuttals…",
          })
        );

        const analysisPayload = {
          raw_input: message,
          category: result.classification.type ?? "other",
          intent: undefined as string | undefined,
          emotional_tone: undefined as string | undefined,
          urgency: undefined as string | undefined,
          confidence: result.classification.confidence,
          signals: result.classification.signals,
        };

        const variantCount = getResponseVariantCountForPlan("free");
        const rebuttals = await generateRebuttals(analysisPayload, {
          variantCount,
        });

        // Persist to DB (best-effort — don't block the WS response on failure)
        app.prisma.rebuttal
          .create({
            data: {
              raw_input: message,
              category: analysisPayload.category,
              intent: null,
              emotional_tone: null,
              urgency: null,
              rebuttal_1: rebuttals.rebuttals[0]?.text ?? "",
              rebuttal_2: rebuttals.rebuttals[1]?.text ?? "",
              rebuttal_3: rebuttals.rebuttals[2]?.text ?? "",
              rebuttals_json: rebuttals as unknown as object,
              confidence: analysisPayload.confidence ?? null,
            },
          })
          .catch((dbErr: unknown) => {
            app.log.error({ err: dbErr }, "WS: failed to persist rebuttal");
          });

        // Stream each rebuttal individually so the frontend can display them
        // progressively as they arrive
        for (const rebuttal of rebuttals.rebuttals) {
          socket.send(
            JSON.stringify({
              type: "rebuttal",
              data: rebuttal,
            })
          );
        }

        // Legacy single-response event for backwards compat with existing frontend
        // Phase 2.3: also include formatted delivery package
        const formattedWs = formatResponse(rebuttals, analysisPayload, {
          variantCount,
        });
        socket.send(
          JSON.stringify({
            type: "response",
            message: rebuttals.rebuttals[0]?.text ?? result.generated.reply,
            rebuttals: rebuttals.rebuttals,
            formatted: formattedWs,
          })
        );

        socket.send(
          JSON.stringify({
            type: "done",
          })
        );
      } catch (error) {
        app.log.error(error);

        socket.send(
          JSON.stringify({
            type: "error",
            message: "Pipeline execution failed",
          })
        );
      }
    });
  });

  cron.schedule("0 2 * * *", () => {
    runPhrasePatternAgent(app.supabase).catch((e) =>
      console.error("[PHRASE_PATTERN_AGENT]", e)
    );
  });

  cron.schedule("0 2 * * *", async () => {
    app.log.info("[cron] queuing nightly entitlement reconciliation");
    await entitlementReconciliationQueue.add(
      { triggeredBy: "cron", timestamp: new Date().toISOString() },
      { jobId: `reconciliation-${new Date().toISOString().slice(0, 10)}` }
    );
  });

  if (process.env.PHRASE_AGENT_RUN_ON_BOOT === "true") {
    runPhrasePatternAgent(app.supabase).catch((e: unknown) => console.error("[PHRASE_PATTERN_AGENT_BOOT]", e));
  }

  await import("./workers/transcriptionWorker.js");
  await import("./workers/outboundWebhookWorker.js");
  await import("./workers/entitlementReconciliationWorker.js").catch((err: unknown) =>
    app.log.error({ err }, "Failed to start entitlement reconciliation worker")
  );

  return app;
}