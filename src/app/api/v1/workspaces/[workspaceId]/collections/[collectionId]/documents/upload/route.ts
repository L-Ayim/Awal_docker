import { createHash } from "crypto";
import { badRequest, conflict, notFound, ok, serverError } from "@/lib/api";
import { serializeIngestionJob, serializeRevision } from "@/lib/ingestion";
import { persistUpload } from "@/lib/uploads";

type RouteContext = {
  params: Promise<{
    workspaceId: string;
    collectionId: string;
  }>;
};

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

    const checksum = createHash("sha256").update(bytes).digest("hex");
    const duplicate = await prisma.document.findFirst({
      where: {
        workspaceId,
        collectionId,
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
      return conflict(`This file was already uploaded as "${duplicate.title}".`, {
        documentId: duplicate.id,
        checksum
      });
    }

    const persisted = await persistUpload({
      workspaceId,
      collectionId,
      filename: file.name,
      bytes
    });

    const created = await prisma.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          workspaceId,
          collectionId,
          title,
          sourceKind: "upload",
          mimeType: file.type || "application/octet-stream",
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
          ingestionMode
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

    return ok(
      {
        document: created.document,
        revision: serializeRevision(created.revision),
        job: serializeIngestionJob(created.job)
      },
      { status: 201 }
    );
  } catch {
    return serverError("Failed to upload document.");
  }
}
