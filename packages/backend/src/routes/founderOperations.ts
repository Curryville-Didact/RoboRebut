import type { FastifyInstance } from "fastify";
import { sendApiError } from "../lib/apiErrors.js";

type OperationsSnapshotResponse = {
  totalUsers: number | null;
  totalConversations: number | null;
  totalMessages: number | null;
  savedResponses: number | null;
  activeUsers7d: number | null;
  planDistribution: {
    free: number | null;
    starter: number | null;
    pro: number | null;
    team: number | null;
  };
  recentUsers: Array<{
    userId: string;
    email: string | null;
    planType: string | null;
    usageCount: number | null;
    createdAt: string | null;
  }>;
  recentConversations: Array<{
    id: string;
    userId: string;
    title: string | null;
    updatedAt: string | null;
    createdAt: string | null;
  }>;
  highUsageAccounts: Array<{
    userId: string;
    email: string | null;
    planType: string | null;
    usageCount: number;
    updatedAt: string | null;
  }>;
};

function founderEmailAllowlist(): string[] {
  const raw =
    process.env.FOUNDER_EMAILS?.trim() ||
    process.env.NEXT_PUBLIC_FOUNDER_EMAILS?.trim() ||
    "";
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  return ["admin@getrebut.ai"];
}

function isFounderEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return false;
  return founderEmailAllowlist().includes(e);
}

async function countRows(
  fastify: FastifyInstance,
  table: string
): Promise<number | null> {
  const { count, error } = await fastify.supabase
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) return null;
  return typeof count === "number" ? count : null;
}

async function countPlanType(
  fastify: FastifyInstance,
  planType: "free" | "starter" | "pro" | "team"
): Promise<number | null> {
  const { count, error } = await fastify.supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("plan_type", planType);
  if (error) return null;
  return typeof count === "number" ? count : null;
}

async function countActiveUsers7d(
  fastify: FastifyInstance
): Promise<number | null> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const pageSize = 1000;
  const maxPages = 20;
  const unique = new Set<string>();

  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await fastify.supabase
      .from("messages")
      .select("user_id")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) return null;
    const rows = Array.isArray(data)
      ? (data as Array<{ user_id?: unknown }>)
      : [];
    for (const row of rows) {
      if (typeof row.user_id === "string" && row.user_id.trim()) {
        unique.add(row.user_id);
      }
    }
    if (rows.length < pageSize) return unique.size;
  }

  // Guard against returning inaccurate bounded scans.
  return null;
}

export async function founderOperationsRoutes(
  fastify: FastifyInstance
): Promise<void> {
  fastify.get("/founder/operations-snapshot", {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const callerEmail = request.user.email ?? null;
      if (!isFounderEmail(callerEmail)) {
        return sendApiError(reply, {
          status: 403,
          code: "FORBIDDEN",
          message: "Forbidden",
        });
      }

      const base: OperationsSnapshotResponse = {
        totalUsers: null,
        totalConversations: null,
        totalMessages: null,
        savedResponses: null,
        activeUsers7d: null,
        planDistribution: { free: null, starter: null, pro: null, team: null },
        recentUsers: [],
        recentConversations: [],
        highUsageAccounts: [],
      };

      try {
        const [
          totalUsers,
          totalConversations,
          totalMessages,
          savedResponses,
          activeUsers7d,
          freeCount,
          starterCount,
          proCount,
          teamCount,
        ] = await Promise.all([
          countRows(fastify, "profiles"),
          countRows(fastify, "conversations"),
          countRows(fastify, "messages"),
          countRows(fastify, "saved_responses"),
          countActiveUsers7d(fastify),
          countPlanType(fastify, "free"),
          countPlanType(fastify, "starter"),
          countPlanType(fastify, "pro"),
          countPlanType(fastify, "team"),
        ]);

        base.totalUsers = totalUsers;
        base.totalConversations = totalConversations;
        base.totalMessages = totalMessages;
        base.savedResponses = savedResponses;
        base.activeUsers7d = activeUsers7d;
        base.planDistribution = {
          free: freeCount,
          starter: starterCount,
          pro: proCount,
          team: teamCount,
        };

        const [recentUsersRes, recentConversationsRes, highUsageRes] =
          await Promise.all([
            fastify.supabase
              .from("profiles")
              .select("id, email, plan_type, usage_count, created_at")
              .order("created_at", { ascending: false })
              .limit(8),
            fastify.supabase
              .from("conversations")
              .select("id, user_id, title, updated_at, created_at")
              .order("updated_at", { ascending: false })
              .limit(8),
            fastify.supabase
              .from("profiles")
              .select("id, email, plan_type, usage_count, updated_at")
              .gt("usage_count", 0)
              .order("usage_count", { ascending: false })
              .limit(8),
          ]);

        if (!recentUsersRes.error && Array.isArray(recentUsersRes.data)) {
          base.recentUsers = recentUsersRes.data.map((r) => {
            const row = r as Record<string, unknown>;
            return {
              userId: typeof row.id === "string" ? row.id : "",
              email: typeof row.email === "string" ? row.email : null,
              planType: typeof row.plan_type === "string" ? row.plan_type : null,
              usageCount:
                typeof row.usage_count === "number" ? row.usage_count : null,
              createdAt:
                typeof row.created_at === "string" ? row.created_at : null,
            };
          });
        }

        if (
          !recentConversationsRes.error &&
          Array.isArray(recentConversationsRes.data)
        ) {
          base.recentConversations = recentConversationsRes.data.map((r) => {
            const row = r as Record<string, unknown>;
            return {
              id: typeof row.id === "string" ? row.id : "",
              userId: typeof row.user_id === "string" ? row.user_id : "",
              title: typeof row.title === "string" ? row.title : null,
              updatedAt:
                typeof row.updated_at === "string" ? row.updated_at : null,
              createdAt:
                typeof row.created_at === "string" ? row.created_at : null,
            };
          });
        }

        if (!highUsageRes.error && Array.isArray(highUsageRes.data)) {
          base.highUsageAccounts = highUsageRes.data
            .map((r) => {
              const row = r as Record<string, unknown>;
              return {
                userId: typeof row.id === "string" ? row.id : "",
                email: typeof row.email === "string" ? row.email : null,
                planType:
                  typeof row.plan_type === "string" ? row.plan_type : null,
                usageCount:
                  typeof row.usage_count === "number" ? row.usage_count : 0,
                updatedAt:
                  typeof row.updated_at === "string" ? row.updated_at : null,
              };
            })
            .filter((r) => r.userId !== "");
        }
      } catch {
        // Keep deterministic safe output with null/empty fallback.
      }

      return reply.send(base);
    },
  });
}

