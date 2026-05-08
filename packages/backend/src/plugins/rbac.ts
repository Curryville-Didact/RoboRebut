import type { FastifyReply, FastifyRequest } from "fastify";

type AllowedRole = "USER" | "ADMIN" | "FOUNDER";

export function requireRole(...roles: AllowedRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const userId = request.user?.id;
    if (!userId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const prisma = request.server.prisma;
    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (!profile) {
      return reply.code(401).send({ error: "User profile not found" });
    }

    if (!roles.includes(profile.role as AllowedRole)) {
      return reply.code(403).send({
        error: "Forbidden",
        required: roles,
        actual: profile.role,
      });
    }
  };
}
