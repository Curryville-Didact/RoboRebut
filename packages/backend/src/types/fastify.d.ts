import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type Redis from "ioredis";

declare module "fastify" {
  interface FastifyInstance {
    supabase: SupabaseClient;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    prisma: PrismaClient;
    redis: Redis;
    config: import("../config.js").Config;
  }

  interface FastifyRequest {
    user: User;
    userId?: string;
    workspaceId?: string;
  }
}
