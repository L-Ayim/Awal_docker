import { createHash } from "crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { pathToFileURL } from "url";
import { PrismaClient } from "@prisma/client";

const DEFAULT_WORKSPACE_NAME = "Awal Workspace";
const DEFAULT_WORKSPACE_SLUG = "awal-workspace";
const DEFAULT_COLLECTION_NAME = "General Documents";
const DEFAULT_UPLOADS_DIR = process.env.UPLOADS_DIR || "/tmp/awal-uploads";

function parseArgs(argv) {
  const flags = new Set();
  const values = [];

  for (const token of argv) {
    if (token.startsWith("--")) {
      flags.add(token);
      continue;
    }

    values.push(token);
  }

  return {
    sourceDir: values[0] ?? null,
    flags
  };
}

function loadEnvFile(envPath) {
  return readFile(envPath, "utf8")
    .then((content) => {
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
    })
    .catch(() => undefined);
}

function safeSegment(value) {
  return value.replace(/[^a-zA-Z0-9-_]/g, "_");
}

function mimeTypeFor(fileName) {
  const extension = path.extname(fileName).toLowerCase();

  if (extension === ".pdf") {
    return "application/pdf";
  }

  if (extension === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  if (extension === ".txt" || extension === ".md") {
    return "text/plain";
  }

  return "application/octet-stream";
}

async function persistUpload({ workspaceId, collectionId, filename, bytes }) {
  const directory = path.join(
    DEFAULT_UPLOADS_DIR,
    safeSegment(workspaceId),
    safeSegment(collectionId)
  );

  await mkdir(directory, { recursive: true });

  const timestamp = Date.now();
  const persistedName = `${timestamp}-${safeSegment(filename || "upload.bin")}`;
  const absolutePath = path.join(directory, persistedName);

  await writeFile(absolutePath, bytes);

  return {
    storageUri: pathToFileURL(absolutePath).href,
    checksum: createHash("sha256").update(bytes).digest("hex"),
    fileSizeBytes: bytes.byteLength
  };
}

async function collectFiles(sourceDir) {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (![".pdf", ".docx", ".txt", ".md"].includes(extension)) {
      continue;
    }

    const absolutePath = path.join(sourceDir, entry.name);
    const details = await stat(absolutePath);

    files.push({
      absolutePath,
      name: entry.name,
      size: details.size
    });
  }

  return files.sort((left, right) => left.name.localeCompare(right.name));
}

async function ensureWorkspace(prisma) {
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

  let collection = await prisma.collection.findFirst({
    where: {
      workspaceId: workspace.id,
      name: DEFAULT_COLLECTION_NAME
    }
  });

  if (!collection) {
    collection = await prisma.collection.create({
      data: {
        workspaceId: workspace.id,
        name: DEFAULT_COLLECTION_NAME,
        description: "Default document collection for Awal chat sessions."
      }
    });
  }

  return { workspace, collection };
}

async function clearCollection(prisma, collectionId) {
  await prisma.document.deleteMany({
    where: {
      collectionId
    }
  });
}

async function enqueueDocument(prisma, params) {
  const bytes = await readFile(params.absolutePath);
  const persisted = await persistUpload({
    workspaceId: params.workspaceId,
    collectionId: params.collectionId,
    filename: params.name,
    bytes
  });

  const document = await prisma.document.create({
    data: {
      workspaceId: params.workspaceId,
      collectionId: params.collectionId,
      title: params.name,
      sourceKind: "upload",
      mimeType: mimeTypeFor(params.name),
      status: "processing"
    }
  });

  const revision = await prisma.documentRevision.create({
    data: {
      documentId: document.id,
      storageUri: persisted.storageUri,
      checksum: persisted.checksum,
      fileSizeBytes: BigInt(persisted.fileSizeBytes),
      status: "uploaded",
      ingestionMode: "standard"
    }
  });

  await prisma.ingestionJob.create({
    data: {
      documentRevisionId: revision.id,
      status: "queued",
      workerHint: "docling"
    }
  });

  await prisma.document.update({
    where: { id: document.id },
    data: {
      latestRevisionId: revision.id
    }
  });

  return {
    documentId: document.id,
    revisionId: revision.id,
    title: document.title
  };
}

async function runQueuedIngestion(baseUrl) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  let completed = 0;

  for (;;) {
    const response = await fetch(`${normalizedBaseUrl}/api/v1/ingestion-jobs/run-next`, {
      method: "POST"
    });

    if (!response.ok) {
      throw new Error(`Failed to process queued ingestion jobs: ${response.status}`);
    }

    const payload = await response.json();
    if (!payload?.processed) {
      if (payload?.reason === "no_queued_jobs") {
        return completed;
      }

      throw new Error(payload?.error || payload?.reason || "Queued ingestion job failed.");
    }

    completed += 1;
    console.log(`processed job ${payload.jobId} for revision ${payload.revisionId}`);
  }
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const { sourceDir, flags } = parseArgs(process.argv.slice(2));

  if (!sourceDir) {
    throw new Error("Usage: node scripts/import-folder.mjs <folder> [--clear] [--process]");
  }

  await loadEnvFile(path.join(repoRoot, ".env"));
  await loadEnvFile(path.join(repoRoot, ".env.local"));

  const prisma = new PrismaClient();

  try {
    const absoluteSourceDir = path.resolve(sourceDir);
    const files = await collectFiles(absoluteSourceDir);

    if (files.length === 0) {
      throw new Error(`No importable files found in ${absoluteSourceDir}`);
    }

    const { workspace, collection } = await ensureWorkspace(prisma);

    if (flags.has("--clear")) {
      await clearCollection(prisma, collection.id);
      console.log(`cleared existing documents from "${collection.name}"`);
    }

    const existingTitles = new Set(
      (
        await prisma.document.findMany({
          where: { collectionId: collection.id },
          select: { title: true }
        })
      ).map((document) => document.title)
    );

    let imported = 0;
    let skipped = 0;

    for (const file of files) {
      if (existingTitles.has(file.name)) {
        skipped += 1;
        console.log(`skipped existing document: ${file.name}`);
        continue;
      }

      await enqueueDocument(prisma, {
        ...file,
        workspaceId: workspace.id,
        collectionId: collection.id
      });

      imported += 1;
      console.log(`queued document: ${file.name}`);
    }

    console.log(`queued ${imported} document(s), skipped ${skipped}`);

    if (flags.has("--process")) {
      const appUrl = process.env.APP_URL || "http://localhost:3000";
      const completed = await runQueuedIngestion(appUrl);
      console.log(`processed ${completed} queued ingestion job(s) via ${appUrl}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
