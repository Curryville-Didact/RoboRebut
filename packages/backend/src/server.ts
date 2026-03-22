import Fastify from "fastify";
import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import { config } from "./config.js";
import prismaPlugin from "./plugins/prisma.js";
import redisPlugin from "./plugins/redis.js";
import websocketPlugin from "./plugins/websocket.js";
import { runObjectionPipeline } from "./lib/runObjectionPipeline.js";
import { rebuttalRoutes } from "./routes/rebuttal.js";
import { generateRebuttals } from "./services/responseGenerator.js";

export async function createServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.nodeEnv === "development" ? "info" : "info",
      transport:
        config.nodeEnv === "development"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
  });

  app.decorate("config", config);

  await app.register(cors, {
    origin: config.frontendUrl,
    credentials: true,
  });

  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  await app.register(websocketPlugin);

  app.get("/health", async () => ({ ok: true }));

  await app.register(rebuttalRoutes);

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

        // Phase 2.1 — classify and analyse the objection
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

        const rebuttals = await generateRebuttals(analysisPayload);

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
        socket.send(
          JSON.stringify({
            type: "response",
            message: rebuttals.rebuttals[0]?.text ?? result.generated.reply,
            rebuttals: rebuttals.rebuttals,
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

  return app;
}