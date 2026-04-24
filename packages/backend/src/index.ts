import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, "../.env");
dotenv.config({ path: envPath, override: true });

/**
 * RoboRebut Backend — entry point.
 * Fastify server with WebSocket, Prisma, Redis.
 * Auth via Clerk JWT or dev shim.
 */
async function main() {
  const { config } = await import("./config.js");
  const { logLlmStartupStatus } = await import("./services/coachChatReply.js");
  logLlmStartupStatus();
  const { createServer } = await import("./server.js");

  const app = await createServer();

  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info({ port: config.port }, "RoboRebut backend listening");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
