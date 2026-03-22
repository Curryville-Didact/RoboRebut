import fp from "fastify-plugin";
import websocket from "@fastify/websocket";
import type { IncomingMessage } from "node:http";

type VerifyClientInfo = {
  origin: string;
  secure: boolean;
  req: IncomingMessage;
};

type VerifyClientCallback = (
  res: boolean,
  code?: number,
  message?: string
) => void;

async function websocketPlugin(app: import("fastify").FastifyInstance) {
  const allowed = new Set(app.config.corsAllowedOrigins);

  await app.register(websocket, {
    options: {
      clientTracking: true,
      verifyClient: (
        info: VerifyClientInfo,
        cb: VerifyClientCallback
      ) => {
        const origin = info.origin;
        if (!origin) {
          cb(true);
          return;
        }
        if (allowed.has(origin)) {
          cb(true);
          return;
        }
        app.log.warn({ origin }, "WebSocket: origin not allowed");
        cb(false, 403, "Forbidden");
      },
    },
  });
}

export default fp(websocketPlugin, { name: "websocket" });
