import { notFound, serverError } from "@/lib/api";
import { readStoredBytes } from "@/lib/storage";

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
        latestRevision: true
      }
    });

    if (!document?.latestRevision?.storageUri) {
      return notFound("Document file not found.");
    }

    const stored = await readStoredBytes(document.latestRevision.storageUri);

    return new Response(stored.bytes, {
      status: 200,
      headers: {
        "Content-Type": stored.mimeType || document.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(document.title)}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch {
    return serverError("Failed to download document.");
  }
}
