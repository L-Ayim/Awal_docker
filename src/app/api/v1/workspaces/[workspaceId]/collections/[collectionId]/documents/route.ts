import { z } from "zod";
import { badRequest, notFound, ok, serverError, validationError } from "@/lib/api";
import { serializeIngestionJob, serializeRevision } from "@/lib/ingestion";

const createDocumentSchema = z.object({
  title: z.string().trim().min(1).max(255),
  sourceKind: z.string().trim().min(1).max(80),
  mimeType: z.string().trim().min(1).max(120),
  storageUri: z.string().trim().max(1000).optional(),
  checksum: z.string().trim().max(255).optional(),
  fileSizeBytes: z.number().int().nonnegative().optional(),
  ingestionMode: z.string().trim().min(1).max(50).default("standard")
});

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
        id: true,
        workspaceId: true
      }
    });

    if (!collection) {
      return notFound("Collection not found for the given workspace.");
    }

    const json = await request.json();
    const parsed = createDocumentSchema.safeParse(json);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const created = await prisma.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          workspaceId,
          collectionId,
          title: parsed.data.title,
          sourceKind: parsed.data.sourceKind,
          mimeType: parsed.data.mimeType,
          status: "uploaded"
        }
      });

      const revision = await tx.documentRevision.create({
        data: {
          documentId: document.id,
          storageUri: parsed.data.storageUri,
          checksum: parsed.data.checksum,
          fileSizeBytes:
            parsed.data.fileSizeBytes !== undefined
              ? BigInt(parsed.data.fileSizeBytes)
              : undefined,
          status: "uploaded",
          ingestionMode: parsed.data.ingestionMode
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
          latestRevisionId: revision.id,
          status: "processing"
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
  } catch (error) {
    return serverError("Failed to create document.");
  }
}
