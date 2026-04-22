import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { notFound, serverError } from "@/lib/api";

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

    if (!document?.latestRevision?.storageUri?.startsWith("file://")) {
      return notFound("Document file not found.");
    }

    const absolutePath = fileURLToPath(document.latestRevision.storageUri);
    const fileBytes = await readFile(absolutePath);

    return new Response(fileBytes, {
      status: 200,
      headers: {
        "Content-Type": document.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(document.title)}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch {
    return serverError("Failed to download document.");
  }
}
