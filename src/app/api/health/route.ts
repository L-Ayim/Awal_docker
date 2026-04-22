import { NextResponse } from "next/server";

export async function GET() {
  try {
    const { getPrisma } = await import("@/lib/prisma");
    const { getAiRuntimeConfig } = await import("@/lib/ai-provider");
    const { getDocumentProcessorRuntimeStatus } = await import("@/lib/document-processor");
    const prisma = getPrisma();
    const docling = getDocumentProcessorRuntimeStatus();
    const ai = getAiRuntimeConfig();
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({
      ok: true,
      service: "awal-api",
      database: "reachable",
      ingestion: {
        parser: "docling+native",
        mode: docling.mode,
        remoteConfigured: docling.configured,
        baseUrl: docling.baseUrl
      },
      ai: {
        generationProviderConfigured: ai.hasGenerationProvider,
        embeddingProviderConfigured: ai.hasEmbeddingProvider,
        rerankProviderConfigured: ai.hasRerankProvider,
        llmModel: ai.llmModel,
        embeddingModel: ai.embeddingModel,
        rerankModel: ai.rerankModel
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        service: "awal-api",
        database: "unreachable",
        error: error instanceof Error ? error.message : "unknown_error"
      },
      { status: 500 }
    );
  }
}
