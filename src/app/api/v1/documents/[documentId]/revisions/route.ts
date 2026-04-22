import { z } from "zod";
import { notFound, ok, serverError, validationError } from "@/lib/api";
import { serializeIngestionJob, serializeRevision } from "@/lib/ingestion";

const createRevisionSchema = z.object({
  storageUri: z.string().trim().max(1000).optional(),
  checksum: z.string().trim().max(255).optional(),
  fileSizeBytes: z.number().int().nonnegative().optional(),
  ingestionMode: z.string().trim().min(1).max(50).default("standard"),
  workerHint: z.string().trim().min(1).max(80).default("docling")
});

type RouteContext = {
  params: Promise<{
    documentId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { getPrisma } = await import("@/lib/prisma");
    const prisma = getPrisma();
    const { documentId } = await context.params;

    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        workspaceId: true,
        collectionId: true,
        title: true
      }
    });

    if (!document) {
      return notFound("Document not found.");
    }

    const json = await request.json();
    const parsed = createRevisionSchema.safeParse(json);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const created = await prisma.$transaction(async (tx) => {
      const revision = await tx.documentRevision.create({
        data: {
          documentId,
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
          workerHint: parsed.data.workerHint
        }
      });

      const updatedDocument = await tx.document.update({
        where: { id: documentId },
        data: {
          latestRevisionId: revision.id,
          status: "processing"
        }
      });

      return { revision, job, document: updatedDocument };
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
    return serverError("Failed to create document revision.");
  }
}
