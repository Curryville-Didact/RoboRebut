import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * TEMPORARY DEV AUTH SHIM — use when CLERK_SECRET_KEY is not set.
 * In dev, pass headers: X-Dev-User-Id, X-Dev-Workspace-Id (Clerk IDs or internal IDs for testing).
 * Replace with Clerk JWT verification when ready. See docs/ARCHITECTURE.md.
 */
const DEV_AUTH_HEADER_USER = "x-dev-user-id";
const DEV_AUTH_HEADER_WORKSPACE = "x-dev-workspace-id";

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const config = request.server.config;
  if (config.clerkSecretKey) {
    // TODO: verify Clerk JWT from Authorization: Bearer <token>
    // For now, still allow dev headers so we can test before frontend sends Clerk token
    const devUserId = request.headers[DEV_AUTH_HEADER_USER];
    const devWorkspaceId = request.headers[DEV_AUTH_HEADER_WORKSPACE];
    if (typeof devUserId === "string" && typeof devWorkspaceId === "string") {
      request.userId = devUserId;
      request.workspaceId = devWorkspaceId;
      return;
    }
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Missing or invalid Authorization" });
    }
    // Stub: accept any Bearer token in dev until Clerk verifyToken is wired
    const token = authHeader.slice(7);
    if (config.nodeEnv === "development" && token === "dev") {
      request.userId = "dev-user";
      request.workspaceId = "dev-workspace";
      return;
    }
    return reply.status(401).send({ error: "Invalid token" });
  }

  // Temporary dev auth shim: no Clerk configured
  const userId = request.headers[DEV_AUTH_HEADER_USER];
  const workspaceId = request.headers[DEV_AUTH_HEADER_WORKSPACE];
  if (typeof userId === "string" && typeof workspaceId === "string") {
    request.userId = userId;
    request.workspaceId = workspaceId;
    return;
  }
  return reply.status(401).send({
    error: "Auth required",
    devHint: `Set headers ${DEV_AUTH_HEADER_USER} and ${DEV_AUTH_HEADER_WORKSPACE} for local dev (no Clerk)`,
  });
}
