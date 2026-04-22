import { slugify } from "@/lib/slug";

export async function createUniqueWorkspaceSlug(name: string) {
  const { getPrisma } = await import("@/lib/prisma");
  const prisma = getPrisma();
  const base = slugify(name) || "workspace";

  const existing = await prisma.workspace.findMany({
    where: {
      slug: {
        startsWith: base
      }
    },
    select: {
      slug: true
    }
  });

  if (!existing.some((item) => item.slug === base)) {
    return base;
  }

  let suffix = 2;
  while (existing.some((item) => item.slug === `${base}-${suffix}`)) {
    suffix += 1;
  }

  return `${base}-${suffix}`;
}
