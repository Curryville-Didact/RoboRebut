import type { FastifyInstance } from "fastify";

export async function isFeatureEnabled(
  app: FastifyInstance,
  key: string
): Promise<boolean> {
  try {
    const flag = await app.prisma.featureFlag.findUnique({
      where: { key },
      select: { enabled: true },
    });
    return flag?.enabled ?? false;
  } catch {
    return true;
  }
}

export async function getAllFlags(app: FastifyInstance): Promise<
  Array<{
    key: string;
    enabled: boolean;
    description: string;
    updatedAt: Date;
    updatedBy: string | null;
  }>
> {
  return app.prisma.featureFlag.findMany({
    orderBy: { key: "asc" },
  });
}

export async function setFlag(
  app: FastifyInstance,
  key: string,
  enabled: boolean,
  updatedBy: string
): Promise<void> {
  await app.prisma.featureFlag.upsert({
    where: { key },
    update: { enabled, updatedBy },
    create: { key, enabled, updatedBy },
  });
}
