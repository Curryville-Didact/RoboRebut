/**
 * supabaseAuth.ts
 *
 * Fastify plugin that:
 * 1. Initialises a Supabase service-role client and decorates the instance
 * 2. Provides an `authenticate` preHandler that validates Bearer tokens
 */

import fp from "fastify-plugin";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

async function supabaseAuthPlugin(fastify: FastifyInstance): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    fastify.log.warn(
      "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — Supabase auth disabled"
    );
    // Decorate with no-op stubs so the server still boots without Supabase config
    fastify.decorate("supabase", null as unknown as SupabaseClient);
    fastify.decorate(
      "authenticate",
      async (_req: FastifyRequest, reply: FastifyReply) => {
        reply.status(503).send({ error: "Auth not configured" });
      }
    );
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  fastify.decorate("supabase", supabase);

  fastify.decorate(
    "authenticate",
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const method = request.method;
      const path =
        (request as FastifyRequest & { routerPath?: string }).routerPath ??
        request.url;

      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        fastify.log.warn(
          { method, path, auth: "missing_or_not_bearer" },
          "[auth] reject 401: no Bearer token"
        );
        return reply.status(401).send({ error: "Missing or invalid Authorization header" });
      }

      const token = authHeader.slice(7);
      fastify.log.info(
        {
          method,
          path,
          auth: "bearer_present",
          tokenLen: token.length,
        },
        "[auth] verify: calling supabase.auth.getUser(jwt)"
      );

      const { data, error } = await supabase.auth.getUser(token);

      if (error || !data.user) {
        fastify.log.warn(
          {
            method,
            path,
            verify: "getUser_failed",
            message: error?.message ?? "no_user",
          },
          "[auth] reject 401: token verification failed"
        );
        return reply.status(401).send({ error: "Invalid or expired token" });
      }

      fastify.log.info(
        { method, path, verify: "ok", userId: data.user.id },
        "[auth] accept: JWT valid"
      );
      request.user = data.user;
    }
  );
}

export default fp(supabaseAuthPlugin, {
  name: "supabaseAuth",
  fastify: "5.x",
});
