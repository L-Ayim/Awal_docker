import { z } from "zod";
import { notFound, ok, serverError, validationError } from "@/lib/api";

const updateConversationSchema = z.object({
  title: z.string().trim().min(1).max(255)
});

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { getPrisma } = await import("@/lib/prisma");
    const prisma = getPrisma();
    const { conversationId } = await context.params;
    const json = await request.json();
    const parsed = updateConversationSchema.safeParse(json);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const existing = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true }
    });

    if (!existing) {
      return notFound("Conversation not found.");
    }

    const conversation = await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        title: parsed.data.title
      }
    });

    return ok({ conversation });
  } catch {
    return serverError("Failed to update conversation.");
  }
}

export async function DELETE(_: Request, context: RouteContext) {
  try {
    const { getPrisma } = await import("@/lib/prisma");
    const prisma = getPrisma();
    const { conversationId } = await context.params;

    const existing = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true }
    });

    if (!existing) {
      return notFound("Conversation not found.");
    }

    await prisma.conversation.delete({
      where: { id: conversationId }
    });

    return ok({
      success: true
    });
  } catch {
    return serverError("Failed to delete conversation.");
  }
}
