import type { FastifyInstance } from "fastify";
import { requireRole } from "../plugins/rbac.js";
import { getAllFlags, setFlag } from "../services/featureFlags.js";

export async function featureFlagRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/admin/flags",
    {
      preHandler: [app.authenticate, requireRole("FOUNDER", "ADMIN")],
    },
    async (_req, reply) => {
      const flags = await getAllFlags(app);
      return reply.send({ flags });
    }
  );

  app.patch<{
    Params: { key: string };
    Body: { enabled?: boolean };
  }>(
    "/admin/flags/:key",
    {
      preHandler: [app.authenticate, requireRole("FOUNDER", "ADMIN")],
    },
    async (req, reply) => {
      const rawKey = req.params.key;
      const flagKey = decodeURIComponent(rawKey);
      const enabled = req.body?.enabled;
      const userId = req.user.id;

      if (typeof enabled !== "boolean") {
        return reply.code(400).send({ error: "enabled must be a boolean" });
      }

      await setFlag(app, flagKey, enabled, userId);
      app.log.info({ key: flagKey, enabled, userId }, "feature flag updated");
      return reply.send({ ok: true, key: flagKey, enabled });
    }
  );

  app.get(
    "/system/status",
    { config: { rateLimit: false } },
    async (_req, reply) => {
      try {
        const flag = await app.prisma.featureFlag.findUnique({
          where: { key: "maintenance_mode" },
          select: { enabled: true, description: true },
        });
        return reply.send({
          maintenance: flag?.enabled ?? false,
          message: flag?.enabled
            ? flag.description ||
              "RoboRebut is undergoing maintenance. We will be back shortly."
            : null,
        });
      } catch {
        return reply.send({ maintenance: false, message: null });
      }
    }
  );
}
