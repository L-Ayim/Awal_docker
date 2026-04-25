import { notFound, ok, serverError } from "@/lib/api";
import { deleteStoredObject } from "@/lib/storage";

type RouteContext = {
  params: Promise<{
    documentId: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  try {
    const { getPrisma } = await import("@/lib/prisma");
    const prisma = getPrisma();
    const { documentId } = await context.params;
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        latestRevision: {
          include: {
            ingestionJobs: {
              orderBy: {
                createdAt: "desc"
              },
              take: 10
            },
            sections: {
              orderBy: {
                ordinal: "asc"
              }
            },
            chunks: {
              orderBy: {
                chunkIndex: "asc"
              },
              include: {
                citationSpans: {
                  orderBy: {
                    startChar: "asc"
                  },
                  take: 1
                },
                embedding: {
                  select: {
                    modelName: true,
                    dimensions: true
                  }
                }
              }
            },
            indexCards: {
              orderBy: [
                { kind: "asc" },
                { createdAt: "asc" }
              ],
              include: {
                embedding: {
                  select: {
                    modelName: true,
                    dimensions: true
                  }
                },
                chunk: {
                  select: {
                    id: true,
                    chunkIndex: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!document) {
      return notFound("Document not found.");
    }

    return ok({
      document: {
        id: document.id,
        title: document.title,
        sourceKind: document.sourceKind,
        mimeType: document.mimeType,
        status: document.status,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        latestRevision: document.latestRevision
          ? {
              id: document.latestRevision.id,
              checksum: document.latestRevision.checksum,
              storageUri: document.latestRevision.storageUri,
              fileSizeBytes:
                document.latestRevision.fileSizeBytes !== null &&
                document.latestRevision.fileSizeBytes !== undefined
                  ? document.latestRevision.fileSizeBytes.toString()
                  : null,
              status: document.latestRevision.status,
              extractionQuality: document.latestRevision.extractionQuality,
              ingestionMode: document.latestRevision.ingestionMode,
              reviewFlag: document.latestRevision.reviewFlag,
              qualityNotes: document.latestRevision.qualityNotes,
              createdAt: document.latestRevision.createdAt,
              updatedAt: document.latestRevision.updatedAt,
              jobs: document.latestRevision.ingestionJobs.map((job) => ({
                id: job.id,
                status: job.status,
                attemptCount: job.attemptCount,
                workerHint: job.workerHint,
                queuedAt: job.queuedAt,
                startedAt: job.startedAt,
                completedAt: job.completedAt,
                lastError: job.lastError
              })),
              sections: document.latestRevision.sections.map((section) => ({
                id: section.id,
                sectionPath: section.sectionPath,
                heading: section.heading,
                ordinal: section.ordinal
              })),
              chunks: document.latestRevision.chunks.map((chunk) => ({
                id: chunk.id,
                chunkIndex: chunk.chunkIndex,
                text: chunk.text,
                tokenCount: chunk.tokenCount,
                charCount: chunk.charCount,
                pageStart: chunk.pageStart,
                pageEnd: chunk.pageEnd,
                paragraphStart: chunk.paragraphStart,
                paragraphEnd: chunk.paragraphEnd,
                lineStart: chunk.lineStart,
                lineEnd: chunk.lineEnd,
                citationQuotedText: chunk.citationSpans[0]?.quotedText ?? null,
                embedding: chunk.embedding
              })),
              indexCards: document.latestRevision.indexCards.map((card) => ({
                id: card.id,
                kind: card.kind,
                title: card.title,
                body: card.body,
                summary: card.summary,
                tags: Array.isArray(card.tagsJson) ? card.tagsJson : [],
                aliases: Array.isArray(card.aliasesJson) ? card.aliasesJson : [],
                pageStart: card.pageStart,
                pageEnd: card.pageEnd,
                paragraphStart: card.paragraphStart,
                paragraphEnd: card.paragraphEnd,
                lineStart: card.lineStart,
                lineEnd: card.lineEnd,
                chunk: card.chunk,
                embedding: card.embedding
              }))
            }
          : null
      }
    });
  } catch {
    return serverError("Failed to load document details.");
  }
}

export async function DELETE(_: Request, context: RouteContext) {
  try {
    const { getPrisma } = await import("@/lib/prisma");
    const prisma = getPrisma();
    const { documentId } = await context.params;
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        revisions: {
          select: {
            storageUri: true
          }
        }
      }
    });

    if (!document) {
      return notFound("Document not found.");
    }

    await prisma.document.delete({
      where: { id: documentId }
    });

    await Promise.all(
      document.revisions.map((revision) => deleteStoredObject(revision.storageUri))
    );

    return ok({
      deleted: true,
      documentId
    });
  } catch {
    return serverError("Failed to delete document.");
  }
}
