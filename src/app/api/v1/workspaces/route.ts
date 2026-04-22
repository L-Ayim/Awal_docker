import { z } from "zod";
import { badRequest, ok, serverError, validationError } from "@/lib/api";
import { createUniqueWorkspaceSlug } from "@/lib/workspace-slug";

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(120).optional()
});

export async function GET() {
  try {
    const { getPrisma } = await import("@/lib/prisma");
    const prisma = getPrisma();
    const workspaces = await prisma.workspace.findMany({
      orderBy: {
        createdAt: "desc"
      },
      include: {
        _count: {
          select: {
            collections: true,
            documents: true,
            conversations: true
          }
        }
      }
    });

    return ok({ workspaces });
  } catch {
    return serverError("Failed to load workspaces.");
  }
}

export async function POST(request: Request) {
  try {
    const { getPrisma } = await import("@/lib/prisma");
    const prisma = getPrisma();
    const json = await request.json();
    const parsed = createWorkspaceSchema.safeParse(json);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const slug =
      parsed.data.slug && parsed.data.slug.length > 0
        ? parsed.data.slug
        : await createUniqueWorkspaceSlug(parsed.data.name);

    const existing = await prisma.workspace.findUnique({
      where: { slug }
    });

    if (existing) {
      return badRequest("Workspace slug already exists.");
    }

    const workspace = await prisma.workspace.create({
      data: {
        name: parsed.data.name,
        slug
      }
    });

    return ok({ workspace }, { status: 201 });
  } catch {
    return serverError("Failed to create workspace.");
  }
}
