import { ok, serverError } from "@/lib/api";

const DEFAULT_WORKSPACE_NAME = "Awal Workspace";
const DEFAULT_WORKSPACE_SLUG = "awal-workspace";
const DEFAULT_COLLECTION_NAME = "General Documents";

export async function GET() {
  try {
    const { getPrisma } = await import("@/lib/prisma");
    const prisma = getPrisma();
    const workspace = await prisma.workspace.upsert({
      where: {
        slug: DEFAULT_WORKSPACE_SLUG
      },
      update: {},
      create: {
        name: DEFAULT_WORKSPACE_NAME,
        slug: DEFAULT_WORKSPACE_SLUG
      }
    });

    let collection = await prisma.collection.findFirst({
      where: {
        workspaceId: workspace.id,
        name: DEFAULT_COLLECTION_NAME
      }
    });

    if (!collection) {
      collection = await prisma.collection.create({
        data: {
          workspaceId: workspace.id,
          name: DEFAULT_COLLECTION_NAME,
          description: "Default document collection for Awal chat sessions."
        }
      });
    }

    return ok({
      workspace,
      collection
    });
  } catch {
    return serverError("Failed to initialize Awal.");
  }
}
