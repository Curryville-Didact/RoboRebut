import fp from "fastify-plugin";
import { Redis } from "ioredis";

async function redisPlugin(app: import("fastify").FastifyInstance) {
  const url = app.config.redisUrl;
  const redis = new Redis(url, { maxRetriesPerRequest: null });
  app.decorate("redis", redis);
  app.addHook("onClose", async (instance) => {
    await instance.redis.quit();
  });
}

export default fp(redisPlugin, { name: "redis" });
