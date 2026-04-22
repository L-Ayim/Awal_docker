import { notFound, ok, serverError } from "@/lib/api";
import { serializeIngestionJob, serializeRevision } from "@/lib/ingestion";

type RouteContext = {
  params: Promise<{
    revisionId: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  try {
    const { getPrisma } = await import("@/lib/prisma");
    const prisma = getPrisma();
    const { revisionId } = await context.params;

    const revision = await prisma.documentRevision.findUnique({
      where: { id: revisionId },
      include: {
        ingestionJobs: {
          orderBy: {
            createdAt: "desc"
          },
          take: 1
        },
        document: {
          select: {
            id: true,
            title: true,
            status: true,
            workspaceId: true,
            collectionId: true
          }
        }
      }
    });

    if (!revision) {
      return notFound("Document revision not found.");
    }

    return ok({
      revision: serializeRevision(revision),
      job: revision.ingestionJobs[0]
        ? serializeIngestionJob(revision.ingestionJobs[0])
        : null,
      document: revision.document
    });
  } catch {
    return serverError("Failed to load revision status.");
  }
}
