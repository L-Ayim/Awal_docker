import { z } from "zod";
import { notFound, ok, serverError, validationError } from "@/lib/api";

const createCollectionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  visibility: z.string().trim().min(1).max(40).default("private")
});

type RouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  try {
    const { getPrisma } = await import("@/lib/prisma");
    const prisma = getPrisma();
    const { workspaceId } = await context.params;

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true }
    });

    if (!workspace) {
      return notFound("Workspace not found.");
    }

    const collections = await prisma.collection.findMany({
      where: { workspaceId },
      orderBy: {
        createdAt: "desc"
      },
      include: {
        _count: {
          select: {
            documents: true,
            conversations: true
          }
        }
      }
    });

    return ok({ collections });
  } catch {
    return serverError("Failed to load collections.");
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { getPrisma } = await import("@/lib/prisma");
    const prisma = getPrisma();
    const { workspaceId } = await context.params;
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true }
    });

    if (!workspace) {
      return notFound("Workspace not found.");
    }

    const json = await request.json();
    const parsed = createCollectionSchema.safeParse(json);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const collection = await prisma.collection.create({
      data: {
        workspaceId,
        name: parsed.data.name,
        description: parsed.data.description,
        visibility: parsed.data.visibility
      }
    });

    return ok({ collection }, { status: 201 });
  } catch {
    return serverError("Failed to create collection.");
  }
}
