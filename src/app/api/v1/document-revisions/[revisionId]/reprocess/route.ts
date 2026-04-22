import { notFound, ok, serverError } from "@/lib/api";
import { serializeIngestionJob, serializeRevision } from "@/lib/ingestion";

type RouteContext = {
  params: Promise<{
    revisionId: string;
  }>;
};

export async function POST(_: Request, context: RouteContext) {
  try {
    const { getPrisma } = await import("@/lib/prisma");
    const prisma = getPrisma();
    const { revisionId } = await context.params;

    const revision = await prisma.documentRevision.findUnique({
      where: { id: revisionId },
      include: {
        document: {
          select: {
            id: true
          }
        }
      }
    });

    if (!revision) {
      return notFound("Document revision not found.");
    }

    const result = await prisma.$transaction(async (tx) => {
      const nextRevision = await tx.documentRevision.update({
        where: { id: revisionId },
        data: {
          status: "uploaded",
          reviewFlag: false,
          qualityNotes: null
        }
      });

      const nextJob = await tx.ingestionJob.create({
        data: {
          documentRevisionId: revisionId,
          status: "queued",
          attemptCount: 0,
          workerHint: "docling"
        }
      });

      const nextDocument = await tx.document.update({
        where: { id: revision.document.id },
        data: {
          latestRevisionId: revisionId,
          status: "processing"
        }
      });

      return {
        revision: nextRevision,
        job: nextJob,
        document: nextDocument
      };
    });

    return ok({
      document: result.document,
      revision: serializeRevision(result.revision),
      job: serializeIngestionJob(result.job)
    });
  } catch {
    return serverError("Failed to requeue document revision.");
  }
}
