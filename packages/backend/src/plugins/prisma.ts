import fp from "fastify-plugin";
import { PrismaClient } from "@prisma/client";

async function prismaPlugin(app: import("fastify").FastifyInstance) {
  const prisma = new PrismaClient();
  app.decorate("prisma", prisma);
  app.addHook("onClose", async (instance) => {
    await instance.prisma.$disconnect();
  });
}

export default fp(prismaPlugin, { name: "prisma" });
