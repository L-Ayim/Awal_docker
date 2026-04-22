import { z } from "zod";
import { badRequest, notFound, ok, serverError, validationError } from "@/lib/api";
import {
  generateEmbeddings,
  generateGroundedAnswer,
  getAiRuntimeConfig,
  rerankEvidence
} from "@/lib/ai-provider";
import { applyRerankScores, composeGroundedAnswer, rankChunks } from "@/lib/retrieval";

const createMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000)
});

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  try {
    const { getPrisma } = await import("@/lib/prisma");
    const prisma = getPrisma();
    const { conversationId } = await context.params;

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true }
    });

    if (!conversation) {
      return notFound("Conversation not found.");
    }

    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: {
        createdAt: "asc"
      },
      include: {
        answerRecord: {
          include: {
            citations: true
          }
        }
      }
    });

    return ok({ messages });
  } catch {
    return serverError("Failed to load messages.");
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { getPrisma } = await import("@/lib/prisma");
    const prisma = getPrisma();
    const { conversationId } = await context.params;
    const json = await request.json();
    const parsed = createMessageSchema.safeParse(json);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        collection: {
          include: {
            documents: {
              include: {
                latestRevision: {
                  include: {
                    chunks: {
                      include: {
                        embedding: true
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!conversation) {
      return notFound("Conversation not found.");
    }

    const readyDocuments = conversation.collection.documents.filter(
      (document) => document.status === "ready" && document.latestRevision?.status === "ready"
    );

    const candidateChunks = readyDocuments.flatMap((document) =>
      (document.latestRevision?.chunks ?? []).map((chunk) => ({
        id: chunk.id,
        text: chunk.text,
        chunkIndex: chunk.chunkIndex,
        documentRevisionId: chunk.documentRevisionId,
        documentTitle: document.title,
        embedding: Array.isArray(chunk.embedding?.vectorJson)
          ? (chunk.embedding?.vectorJson as number[])
          : null
      }))
    );

    const aiConfig = getAiRuntimeConfig();
    let queryEmbedding: number[] | null = null;
    let rerankResult: Awaited<ReturnType<typeof rerankEvidence>> | null = null;

    if (aiConfig.hasEmbeddingProvider && candidateChunks.some((chunk) => chunk.embedding)) {
      try {
        queryEmbedding = (await generateEmbeddings([parsed.data.content])).data[0]?.embedding ?? null;
      } catch {
        queryEmbedding = null;
      }
    }

    const initialMatches = rankChunks({
      query: parsed.data.content,
      chunks: candidateChunks,
      queryEmbedding,
      limit: 10
    });

    if (aiConfig.hasRerankProvider && initialMatches.length > 0) {
      try {
        rerankResult = await rerankEvidence({
          query: parsed.data.content,
          matches: initialMatches.map((match) => ({
            text: match.text,
            chunkIndex: match.chunkIndex,
            documentTitle: match.documentTitle
          }))
        });
      } catch {
        rerankResult = null;
      }
    }

    const rankedMatches = rerankResult
      ? applyRerankScores({
          matches: initialMatches,
          rerankScores: rerankResult.data,
          limit: 5
        })
      : initialMatches.slice(0, 5);

    let generated:
      | Awaited<ReturnType<typeof generateGroundedAnswer>>
      | null = null;
    let generationFailureReason: string | null = null;

    if (readyDocuments.length > 0 && rankedMatches.length > 0) {
      try {
        generated = await generateGroundedAnswer({
          query: parsed.data.content,
          matches: rankedMatches.map((match) => ({
            text: match.text,
            chunkIndex: match.chunkIndex,
            documentTitle: match.documentTitle
          }))
        });
      } catch (error) {
        generationFailureReason =
          error instanceof Error ? error.message : "generation_provider_failed";
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const userMessage = await tx.message.create({
        data: {
          conversationId,
          role: "user",
          content: parsed.data.content
        }
      });

      const assistantContent =
        readyDocuments.length === 0
          ? "This collection does not have any ready documents yet. Upload and process a document before asking grounded questions."
          : rankedMatches.length === 0
            ? "I could not find grounded evidence for that question in the processed document set."
            : generated?.provider === "vast-openai-compatible"
              ? generated.answer
              : composeGroundedAnswer({
                  query: parsed.data.content,
                  matches: rankedMatches.map((match) => ({
                    text: match.text,
                    chunkIndex: match.chunkIndex,
                    documentTitle: match.documentTitle
                  }))
                });

      const assistantState =
        readyDocuments.length === 0
          ? "ingestion_pending"
          : rankedMatches.length === 0
            ? "insufficient_evidence"
            : generated?.answerState ?? "grounded_answer";

      const assistantMessage = await tx.message.create({
        data: {
          conversationId,
          role: "assistant",
          content: assistantContent
        }
      });

      const answerRecord = await tx.answerRecord.create({
        data: {
          conversationId,
          messageId: assistantMessage.id,
          state: assistantState,
          modelName:
            generated?.modelName ??
            (aiConfig.hasGenerationProvider ? aiConfig.llmModel : null),
          refusalReason:
            readyDocuments.length === 0
              ? "no_ready_documents"
              : rankedMatches.length === 0
                ? "no_matching_evidence"
                : generated?.answerState === "insufficient_evidence"
                  ? "model_reported_insufficient_evidence"
                : generationFailureReason
                  ? generationFailureReason.slice(0, 255)
                  : null
        }
      });

      if (rankedMatches.length > 0) {
        const retrievalTrace = await tx.retrievalTrace.create({
          data: {
            conversationId,
            messageId: assistantMessage.id,
            queryText: parsed.data.content,
            retrievalMode: rerankResult
              ? "lexical+dense+rerank"
              : queryEmbedding
                ? "lexical+dense"
                : aiConfig.hasGenerationProvider
                  ? "lexical+llm"
                  : "lexical",
            thresholdPassed: true
          }
        });

        for (const [index, match] of rankedMatches.entries()) {
          await tx.retrievalCandidate.create({
            data: {
              retrievalTraceId: retrievalTrace.id,
              chunkId: match.id,
              denseScore: match.denseScore,
              lexicalScore: match.lexicalScore,
              hybridScore: match.hybridScore,
              rerankScore: match.rerankScore,
              finalRank: index + 1,
              selected: true
            }
          });
        }
      }

      return { userMessage, assistantMessage, answerRecord };
    });

    return ok(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Foreign key constraint")) {
      return badRequest("Invalid conversation message request.");
    }

    console.error("conversation_messages_post_failed", error);

    return serverError(
      error instanceof Error
        ? `Failed to create conversation message. ${error.message}`
        : "Failed to create conversation message."
    );
  }
}
