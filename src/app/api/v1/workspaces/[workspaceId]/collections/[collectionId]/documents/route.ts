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

export async function GET(request: Request, context: RouteContext) {
  try {
    const { getPrisma } = await import("@/lib/prisma");
    const prisma = getPrisma();
    const { workspaceId, collectionId } = await context.params;
    const searchParams = new URL(request.url).searchParams;
    const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1);
    const pageSize = Math.max(
      10,
      Math.min(100, Number.parseInt(searchParams.get("pageSize") || "25", 10) || 25)
    );
    const skip = (page - 1) * pageSize;
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

    const where = {
      workspaceId,
      collectionId,
      status: {
        not: "archived" as const
      }
    };
    const [total, readyCount, workingCount, failedCount, documents] = await prisma.$transaction([
      prisma.document.count({ where }),
      prisma.document.count({ where: { ...where, status: "ready" } }),
      prisma.document.count({ where: { ...where, status: { in: ["uploaded", "processing"] } } }),
      prisma.document.count({ where: { ...where, status: "failed" } }),
      prisma.document.findMany({
        where,
        orderBy: {
          updatedAt: "desc"
        },
        skip,
        take: pageSize,
        include: {
          latestRevision: {
            include: {
              ingestionJobs: {
                orderBy: {
                  createdAt: "desc"
                },
                take: 1
              },
              _count: {
                select: {
                  chunks: true,
                  indexCards: true
                }
              }
            }
          }
        }
      })
    ]);

    return ok({
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
      },
      summary: {
        total,
        ready: readyCount,
        working: workingCount,
        failed: failedCount
      },
      documents: documents.map((document) => ({
        id: document.id,
        title: document.title,
        sourceKind: document.sourceKind,
        mimeType: document.mimeType,
        status: document.status,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        latestRevision: document.latestRevision
          ? {
              ...serializeRevision(document.latestRevision),
              chunkCount: document.latestRevision._count.chunks,
              indexCardCount: document.latestRevision._count.indexCards
            }
          : null,
        latestJob: document.latestRevision?.ingestionJobs[0]
          ? serializeIngestionJob(document.latestRevision.ingestionJobs[0])
          : null
      }))
    });
  } catch {
    return serverError("Failed to list documents.");
  }
}
