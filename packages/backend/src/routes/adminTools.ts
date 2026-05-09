import type { FastifyInstance } from "fastify";
import { requireRole } from "../plugins/rbac.js";

export async function adminToolsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: { email?: string };
  }>(
    "/admin/users/lookup",
    {
      preHandler: [app.authenticate, requireRole("FOUNDER", "ADMIN")],
      schema: {
        querystring: {
          type: "object",
          properties: { email: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const email = (req.query.email ?? "").trim();
      if (!email) return reply.code(400).send({ error: "email is required" });

      const { data: profiles, error } = await app.supabase
        .from("profiles")
        .select(
          "id, email, plan_type, usage_count, usage_reset_at, created_at, role"
        )
        .ilike("email", `%${email}%`)
        .limit(5);

      if (error) return reply.code(500).send({ error: error.message });
      return reply.send({ users: profiles ?? [] });
    }
  );

  app.post<{
    Params: { userId: string };
    Body: { usageCount?: number; planType?: string };
  }>(
    "/admin/users/:userId/usage-override",
    {
      preHandler: [app.authenticate, requireRole("FOUNDER", "ADMIN")],
    },
    async (req, reply) => {
      const { userId } = req.params;
      const { usageCount, planType } = req.body ?? {};

      if (usageCount === undefined && planType === undefined) {
        return reply
          .code(400)
          .send({ error: "usageCount or planType required" });
      }

      const updates: Record<string, unknown> = {};
      if (usageCount !== undefined) updates.usage_count = usageCount;
      if (planType !== undefined) updates.plan_type = planType;

      const { error } = await app.supabase
        .from("profiles")
        .update(updates)
        .eq("id", userId);

      if (error) return reply.code(500).send({ error: error.message });

      app.log.info(
        { userId, updates, adminId: req.user.id },
        "admin usage override applied"
      );
      return reply.send({ ok: true, userId, updates });
    }
  );

  app.post<{
    Params: { userId: string };
    Body: { role?: string };
  }>(
    "/admin/users/:userId/role",
    {
      preHandler: [app.authenticate, requireRole("FOUNDER", "ADMIN")],
    },
    async (req, reply) => {
      const { userId } = req.params;
      const role = req.body?.role ?? "";

      const validRoles = ["USER", "ADMIN", "FOUNDER"];
      if (!validRoles.includes(role)) {
        return reply.code(400).send({
          error: `role must be one of: ${validRoles.join(", ")}`,
        });
      }

      const { error } = await app.supabase
        .from("profiles")
        .update({ role })
        .eq("id", userId);

      if (error) return reply.code(500).send({ error: error.message });

      app.log.info(
        { userId, role, adminId: req.user.id },
        "admin role change applied"
      );
      return reply.send({ ok: true, userId, role });
    }
  );

  app.get(
    "/admin/stats",
    {
      preHandler: [app.authenticate, requireRole("FOUNDER", "ADMIN")],
    },
    async (_req, reply) => {
      const [profilesRes, convRes, proRes] = await Promise.all([
        app.supabase.from("profiles").select("*", { count: "exact", head: true }),
        app.supabase
          .from("conversations")
          .select("*", { count: "exact", head: true }),
        app.supabase
          .from("profiles")
          .select("*", { count: "exact", head: true })
          .neq("plan_type", "free"),
      ]);

      if (profilesRes.error)
        return reply.code(500).send({ error: profilesRes.error.message });
      if (convRes.error)
        return reply.code(500).send({ error: convRes.error.message });
      if (proRes.error)
        return reply.code(500).send({ error: proRes.error.message });

      return reply.send({
        totalUsers: profilesRes.count ?? 0,
        totalConversations: convRes.count ?? 0,
        proUsers: proRes.count ?? 0,
        timestamp: new Date().toISOString(),
      });
    }
  );
}
