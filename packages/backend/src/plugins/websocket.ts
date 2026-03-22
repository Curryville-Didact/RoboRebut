import fp from "fastify-plugin";
import websocket from "@fastify/websocket";

async function websocketPlugin(app: import("fastify").FastifyInstance) {
  await app.register(websocket, {
    options: { clientTracking: true },
  });
}

export default fp(websocketPlugin, { name: "websocket" });
