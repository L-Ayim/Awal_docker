import { z } from "zod";

const appEnvSchema = z.object({
  APP_NAME: z.string().min(1).default("Awal"),
  APP_URL: z.string().url().default("http://localhost:3000")
});

const databaseEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1)
});

export const appEnv = appEnvSchema.parse({
  APP_NAME: process.env.APP_NAME ?? "Awal",
  APP_URL: process.env.APP_URL ?? "http://localhost:3000"
});

export function getDatabaseEnv() {
  return databaseEnvSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL
  });
}
