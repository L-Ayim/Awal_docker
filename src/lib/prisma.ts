import { PrismaClient } from "@prisma/client";
import { getDatabaseEnv } from "@/lib/env";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export function getPrisma() {
  getDatabaseEnv();

  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
    });
  }

  return global.__prisma;
}
