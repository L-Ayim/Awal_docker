import { createHash } from "crypto";
import JSZip from "jszip";
import { badRequest, conflict, notFound, ok, serverError } from "@/lib/api";
import { serializeIngestionJob, serializeRevision } from "@/lib/ingestion";
import { persistUpload } from "@/lib/uploads";

type RouteContext = {
  params: Promise<{
    workspaceId: string;
    collectionId: string;
  }>;
};

const MAX_ZIP_FILES = 500;
const MAX_ZIP_UNCOMPRESSED_BYTES = 750 * 1024 * 1024;

const supportedMimeByExtension = new Map<string, string>([
  [".pdf", "application/pdf"],
  [".txt", "text/plain"],
  [".md", "text/markdown"],
  [".markdown", "text/markdown"],
  [".csv", "text/csv"],
  [".json", "application/json"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".html", "text/html"],
  [".htm", "text/html"]
]);

type UploadItem = {
  title: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
};

function normalizeZipPath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function extensionOf(value: string) {
  const normalized = value.toLowerCase();
  const index = normalized.lastIndexOf(".");

  return index >= 0 ? normalized.slice(index) : "";
}

function isZipUpload(file: File, title: string) {
  return (
    /\.zip$/i.test(title || file.name) ||
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed"
  );
}

function isSkippableZipPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  const basename = parts.at(-1) || "";

  return (
    parts.length === 0 ||
    parts.some((part) => part === "__MACOSX") ||
    basename === ".DS_Store" ||
    basename.startsWith("~$")
  );
}

function mimeTypeFor(filename: string, fallback = "application/octet-stream") {
  return supportedMimeByExtension.get(extensionOf(filename)) || fallback;
}

function isSupportedDocument(filename: string) {
  return supportedMimeByExtension.has(extensionOf(filename));
}

async function createUploadedDocument(params: {
  prisma: Awaited<ReturnType<typeof import("@/lib/prisma").getPrisma>>;
  workspaceId: string;
  collectionId: string;
  item: UploadItem;
  ingestionMode: string;
}) {
  const checksum = createHash("sha256").update(params.item.bytes).digest("hex");
  const duplicate = await params.prisma.document.findFirst({
    where: {
      workspaceId: params.workspaceId,
      collectionId: params.collectionId,
      status: {
        not: "archived"
      },
      revisions: {
        some: {
          checksum
        }
      }
    },
    select: {
      id: true,
      title: true
    },
    orderBy: {
      updatedAt: "desc"
    }
  });

  if (duplicate) {
    return {
      skipped: true as const,
      reason: "duplicate",
      title: params.item.title,
      documentId: duplicate.id
    };
  }

  const persisted = await persistUpload({
    workspaceId: params.workspaceId,
    collectionId: params.collectionId,
    filename: params.item.filename,
    bytes: params.item.bytes
  });

  const created = await params.prisma.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: {
        workspaceId: params.workspaceId,
        collectionId: params.collectionId,
        title: params.item.title,
        sourceKind: "upload",
        mimeType: params.item.mimeType,
        status: "processing"
      }
    });

    const revision = await tx.documentRevision.create({
      data: {
        documentId: document.id,
        storageUri: persisted.storageUri,
        checksum: persisted.checksum,
        fileSizeBytes: BigInt(persisted.fileSizeBytes),
        status: "uploaded",
        ingestionMode: params.ingestionMode
      }
    });

    const job = await tx.ingestionJob.create({
      data: {
        documentRevisionId: revision.id,
        status: "queued",
        workerHint: "docling"
      }
    });

    const updatedDocument = await tx.document.update({
      where: { id: document.id },
      data: {
        latestRevisionId: revision.id
      }
    });

    return { document: updatedDocument, revision, job };
  });

  return {
    skipped: false as const,
    document: created.document,
    revision: serializeRevision(created.revision),
    job: serializeIngestionJob(created.job)
  };
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { getPrisma } = await import("@/lib/prisma");
    const prisma = getPrisma();
    const { workspaceId, collectionId } = await context.params;

    const collection = await prisma.collection.findFirst({
      where: {
        id: collectionId,
        workspaceId
      },
      select: {
        id: true
      }
    });

    if (!collection) {
      return notFound("Collection not found for the given workspace.");
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const titleValue = formData.get("title");
    const ingestionModeValue = formData.get("ingestionMode");

    if (!(file instanceof File)) {
      return badRequest("A file upload is required.");
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    if (bytes.byteLength === 0) {
      return badRequest("Uploaded file is empty.");
    }

    const title =
      typeof titleValue === "string" && titleValue.trim().length > 0
        ? titleValue.trim()
        : file.name;

    const ingestionMode =
      typeof ingestionModeValue === "string" && ingestionModeValue.trim().length > 0
        ? ingestionModeValue.trim()
        : "standard";

    if (isZipUpload(file, title)) {
      const zip = await JSZip.loadAsync(bytes);
      const entries = Object.values(zip.files)
        .filter((entry) => !entry.dir)
        .map((entry) => ({
          entry,
          path: normalizeZipPath(entry.name)
        }))
        .filter(({ path }) => !isSkippableZipPath(path));
      const supportedEntries = entries.filter(({ path }) => isSupportedDocument(path));

      if (supportedEntries.length === 0) {
        return badRequest("The zip did not contain any supported document files.");
      }

      if (supportedEntries.length > MAX_ZIP_FILES) {
        return badRequest(`Zip contains ${supportedEntries.length} supported files; the limit is ${MAX_ZIP_FILES}.`);
      }

      const results = [];
      let totalUncompressedBytes = 0;

      for (const { entry, path } of supportedEntries) {
        const entryBytes = new Uint8Array(await entry.async("uint8array"));
        totalUncompressedBytes += entryBytes.byteLength;

        if (totalUncompressedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
          return badRequest("Zip contents are too large after extraction.");
        }

        if (entryBytes.byteLength === 0) {
          results.push({
            skipped: true,
            reason: "empty",
            title: path
          });
          continue;
        }

        results.push(
          await createUploadedDocument({
            prisma,
            workspaceId,
            collectionId,
            item: {
              title: path,
              filename: path.split("/").at(-1) || path,
              mimeType: mimeTypeFor(path),
              bytes: entryBytes
            },
            ingestionMode
          })
        );
      }

      const created = results.filter((result) => !result.skipped);
      const skipped = results.filter((result) => result.skipped);

      return ok(
        {
          archive: {
            title,
            fileCount: supportedEntries.length,
            createdCount: created.length,
            skippedCount: skipped.length
          },
          documents: created,
          skipped
        },
        { status: created.length > 0 ? 201 : 409 }
      );
    }

    const created = await createUploadedDocument({
      prisma,
      workspaceId,
      collectionId,
      item: {
        title,
        filename: file.name,
        mimeType: file.type || mimeTypeFor(file.name),
        bytes
      },
      ingestionMode
    });

    if (created.skipped) {
      return conflict(`This file was already uploaded as "${created.title}".`, {
        documentId: created.documentId
      });
    }

    return ok(
      {
        document: created.document,
        revision: created.revision,
        job: created.job
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("upload_failed", error);
    return serverError("Failed to upload document.");
  }
}
