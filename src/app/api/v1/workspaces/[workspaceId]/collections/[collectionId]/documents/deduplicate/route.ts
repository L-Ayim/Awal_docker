import { ok, serverError } from "@/lib/api";
import { deleteStoredObject } from "@/lib/storage";

type RouteContext = {
  params: Promise<{
    workspaceId: string;
    collectionId: string;
  }>;
};

function buildDuplicateKey(document: {
  title: string;
  latestRevision: {
    checksum: string | null;
    fileSizeBytes: bigint | null;
  } | null;
}) {
  const checksum = document.latestRevision?.checksum?.trim();

  if (checksum) {
    return `checksum:${checksum}`;
  }

  const size =
    document.latestRevision?.fileSizeBytes !== null &&
    document.latestRevision?.fileSizeBytes !== undefined
      ? document.latestRevision.fileSizeBytes.toString()
      : "unknown";

  return `title-size:${document.title.trim().toLowerCase()}::${size}`;
}

export async function POST(_: Request, context: RouteContext) {
  try {
    const { getPrisma } = await import("@/lib/prisma");
    const prisma = getPrisma();
    const { workspaceId, collectionId } = await context.params;

    const documents = await prisma.document.findMany({
      where: {
        workspaceId,
        collectionId,
        status: {
          not: "archived"
        }
      },
      include: {
        latestRevision: true,
        revisions: {
          select: {
            storageUri: true
          }
        }
      },
      orderBy: [
        { updatedAt: "desc" },
        { createdAt: "desc" }
      ]
    });

    const groups = new Map<string, typeof documents>();

    for (const document of documents) {
      const key = buildDuplicateKey(document);
      const existing = groups.get(key) ?? [];
      existing.push(document);
      groups.set(key, existing);
    }

    const duplicates = Array.from(groups.values()).filter((group) => group.length > 1);
    const removed: Array<{ id: string; title: string }> = [];
    const storageUris = new Set<string>();

    for (const group of duplicates) {
      const keep = group[0];

      for (const duplicate of group.slice(1)) {
        removed.push({
          id: duplicate.id,
          title: duplicate.title
        });

        for (const revision of duplicate.revisions) {
          if (revision.storageUri) {
            storageUris.add(revision.storageUri);
          }
        }

        await prisma.document.delete({
          where: { id: duplicate.id }
        });
      }

      void keep;
    }

    await Promise.all(Array.from(storageUris).map((storageUri) => deleteStoredObject(storageUri)));

    return ok({
      removedCount: removed.length,
      removed
    });
  } catch {
    return serverError("Failed to remove duplicate documents.");
  }
}
