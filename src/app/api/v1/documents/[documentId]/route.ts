import { notFound, ok, serverError } from "@/lib/api";
import { deleteStoredObject } from "@/lib/storage";

type RouteContext = {
  params: Promise<{
    documentId: string;
  }>;
};

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
