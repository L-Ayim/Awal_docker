import { z } from "zod";
import { badRequest, ok, serverError, validationError } from "@/lib/api";

const createConversationSchema = z.object({
  workspaceId: z.string().trim().min(1),
  collectionId: z.string().trim().min(1),
  title: z.string().trim().max(255).optional()
});

export async function GET(request: Request) {
  try {
    const { getPrisma } = await import("@/lib/prisma");
    const prisma = getPrisma();
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId") ?? undefined;
    const collectionId = searchParams.get("collectionId") ?? undefined;

    const conversations = await prisma.conversation.findMany({
      where: {
        ...(workspaceId ? { workspaceId } : {}),
        ...(collectionId ? { collectionId } : {})
      },
      orderBy: {
        updatedAt: "desc"
      },
      include: {
        _count: {
          select: {
            messages: true
          }
        }
      }
    });

    return ok({ conversations });
  } catch {
    return serverError("Failed to load conversations.");
  }
}

export async function POST(request: Request) {
  try {
    const { getPrisma } = await import("@/lib/prisma");
    const prisma = getPrisma();
    const json = await request.json();
    const parsed = createConversationSchema.safeParse(json);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const collection = await prisma.collection.findFirst({
      where: {
        id: parsed.data.collectionId,
        workspaceId: parsed.data.workspaceId
      },
      select: {
        id: true
      }
    });

    if (!collection) {
      return badRequest("Collection does not belong to the given workspace.");
    }

    const conversation = await prisma.conversation.create({
      data: {
        workspaceId: parsed.data.workspaceId,
        collectionId: parsed.data.collectionId,
        title: parsed.data.title
      }
    });

    return ok({ conversation }, { status: 201 });
  } catch {
    return serverError("Failed to create conversation.");
  }
}
