import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const DEFAULT_WORKSPACE_NAME = "Awal Workspace";
const DEFAULT_WORKSPACE_SLUG = "awal-workspace";
const DEFAULT_COLLECTION_NAME = "General Documents";

function exec(command, args) {
  const child = spawn(command, args, {
    shell: process.platform === "win32",
    stdio: "inherit",
    env: process.env
  });

  return new Promise((resolve, reject) => {
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

async function loadEnvFile(envPath) {
  try {
    const content = await readFile(envPath, "utf8");

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      const value = rawValue.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");

      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // Env files are optional; CI/Fly usually injects env directly.
  }
}

function requireEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function ensureBootstrapRows() {
  const prisma = new PrismaClient();

  try {
    const workspace = await prisma.workspace.upsert({
      where: {
        slug: DEFAULT_WORKSPACE_SLUG
      },
      update: {},
      create: {
        name: DEFAULT_WORKSPACE_NAME,
        slug: DEFAULT_WORKSPACE_SLUG
      }
    });

    const collection =
      (await prisma.collection.findFirst({
        where: {
          workspaceId: workspace.id,
          name: DEFAULT_COLLECTION_NAME
        }
      })) ??
      (await prisma.collection.create({
        data: {
          workspaceId: workspace.id,
          name: DEFAULT_COLLECTION_NAME,
          description: "Default document collection for Awal chat sessions."
        }
      }));

    console.log(
      JSON.stringify(
        {
          ok: true,
          workspaceId: workspace.id,
          collectionId: collection.id
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");

  await loadEnvFile(path.join(repoRoot, ".env"));
  await loadEnvFile(path.join(repoRoot, ".env.local"));

  requireEnv("DATABASE_URL");
  requireEnv("DIRECT_URL");

  await exec("npx", ["prisma", "generate"]);
  await exec("npx", ["prisma", "db", "push"]);
  await ensureBootstrapRows();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
