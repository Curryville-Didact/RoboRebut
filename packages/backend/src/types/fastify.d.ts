import type { PrismaClient } from "@prisma/client";
import type Redis from "ioredis";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    redis: Redis;
    config: import("../config.js").Config;
  }
}

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
    workspaceId?: string;
  }
}
