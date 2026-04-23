import { z } from "zod";
import { badRequest, notFound, ok, serverError, validationError } from "@/lib/api";
import {
  generateEmbeddings,
  generateGroundedAnswer,
  getAiRuntimeConfig,
  rerankEvidence
} from "@/lib/ai-provider";
import { applyRerankScores, rankChunks } from "@/lib/retrieval";

const createMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000)
});

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

function buildInlineCitationLabel(params: {
  documentTitle: string;
  pageStart: number | null;
  pageEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  paragraphStart: number | null;
  paragraphEnd: number | null;
}) {
  const location = [
    params.pageStart !== null
      ? params.pageEnd !== null && params.pageEnd !== params.pageStart
        ? `pages ${params.pageStart}-${params.pageEnd}`
        : `page ${params.pageStart}`
      : null,
    params.lineStart !== null
      ? params.lineEnd !== null && params.lineEnd !== params.lineStart
        ? `lines ${params.lineStart}-${params.lineEnd}`
        : `line ${params.lineStart}`
      : null,
    params.paragraphStart !== null
      ? params.paragraphEnd !== null && params.paragraphEnd !== params.paragraphStart
        ? `paragraphs ${params.paragraphStart}-${params.paragraphEnd}`
        : `paragraph ${params.paragraphStart}`
      : null
  ]
    .filter(Boolean)
    .join(", ");

  return `[${params.documentTitle}${location ? `, ${location}` : ""}]`;
}

function buildCitationSuffix(
  evidenceIds: number[],
  matches: Array<{
    documentTitle: string;
    pageStart: number | null;
    pageEnd: number | null;
    paragraphStart: number | null;
    paragraphEnd: number | null;
    lineStart: number | null;
    lineEnd: number | null;
  }>
) {
  const labels = Array.from(
    new Set(
      evidenceIds
        .map((evidenceId) => matches[evidenceId - 1])
        .filter(Boolean)
        .map((match) => buildInlineCitationLabel(match))
    )
  );

  return labels.length > 0 ? ` ${labels.join(" ")}` : "";
}

function renderStructuredAnswer(params: {
  lead: {
    text: string;
    evidenceIds: number[];
  };
  bullets: Array<{
    text: string;
    evidenceIds: number[];
  }>;
  matches: Array<{
    documentTitle: string;
    pageStart: number | null;
    pageEnd: number | null;
    paragraphStart: number | null;
    paragraphEnd: number | null;
    lineStart: number | null;
    lineEnd: number | null;
  }>;
}) {
  const lead = `${params.lead.text.trim()}${buildCitationSuffix(
    params.lead.evidenceIds,
    params.matches
  )}`.trim();

  const bullets = params.bullets
    .map((bullet) => {
      const text = bullet.text.trim();

      if (!text) {
        return null;
      }

      return `- ${text}${buildCitationSuffix(bullet.evidenceIds, params.matches)}`.trim();
    })
    .filter(Boolean);

  return [lead, bullets.length > 0 ? "" : null, ...bullets].filter(Boolean).join("\n");
}

function collectUsedEvidenceIds(params: {
  lead: {
    evidenceIds: number[];
  };
  bullets: Array<{
    evidenceIds: number[];
  }>;
}) {
  return Array.from(
    new Set([
      ...params.lead.evidenceIds,
      ...params.bullets.flatMap((bullet) => bullet.evidenceIds)
    ])
  );
}

function formatLocationLabel(params: {
  pageStart: number | null;
  pageEnd: number | null;
  paragraphStart: number | null;
  paragraphEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
}) {
  const segments = [
    params.pageStart !== null
      ? params.pageEnd !== null && params.pageEnd !== params.pageStart
        ? `pages ${params.pageStart}-${params.pageEnd}`
        : `page ${params.pageStart}`
      : null,
    params.paragraphStart !== null
      ? params.paragraphEnd !== null && params.paragraphEnd !== params.paragraphStart
        ? `paragraphs ${params.paragraphStart}-${params.paragraphEnd}`
        : `paragraph ${params.paragraphStart}`
      : null,
    params.lineStart !== null
      ? params.lineEnd !== null && params.lineEnd !== params.lineStart
        ? `lines ${params.lineStart}-${params.lineEnd}`
        : `line ${params.lineStart}`
      : null
  ].filter(Boolean);

  return segments.join(", ");
}

function serializeMessage(message: {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: Date;
  answerRecord?: {
    state: string;
    modelName: string | null;
    citations: Array<{
      citationOrder: number;
      citationSpan: {
        quotedText: string;
        pageStart: number | null;
        pageEnd: number | null;
        paragraphStart: number | null;
        paragraphEnd: number | null;
        lineStart: number | null;
        lineEnd: number | null;
        chunk: {
          text: string;
          documentRevision: {
            document: {
              id: string;
              title: string;
              mimeType: string;
            };
          };
        };
      };
    }>;
  } | null;
}) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    answerRecord: message.answerRecord
      ? {
          state: message.answerRecord.state,
          modelName: message.answerRecord.modelName,
          citations: message.answerRecord.citations.map((citation) => ({
            citationOrder: citation.citationOrder,
            quotedText: citation.citationSpan.quotedText,
            locationLabel: formatLocationLabel(citation.citationSpan),
            pageStart: citation.citationSpan.pageStart,
            pageEnd: citation.citationSpan.pageEnd,
            paragraphStart: citation.citationSpan.paragraphStart,
            paragraphEnd: citation.citationSpan.paragraphEnd,
            lineStart: citation.citationSpan.lineStart,
            lineEnd: citation.citationSpan.lineEnd,
            document: {
              id: citation.citationSpan.chunk.documentRevision.document.id,
              title: citation.citationSpan.chunk.documentRevision.document.title,
              mimeType: citation.citationSpan.chunk.documentRevision.document.mimeType
            }
          }))
        }
      : null
  };
}

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
            citations: {
              orderBy: {
                citationOrder: "asc"
              },
              include: {
                citationSpan: {
                  include: {
                    chunk: {
                      include: {
                        documentRevision: {
                          include: {
                            document: {
                              select: {
                                id: true,
                                title: true,
                                mimeType: true
                              }
                            }
                          }
                        }
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

    return ok({ messages: messages.map(serializeMessage) });
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
                        embedding: true,
                        citationSpans: {
                          take: 1,
                          orderBy: {
                            startChar: "asc"
                          }
                        }
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
        documentId: document.id,
        documentRevisionId: chunk.documentRevisionId,
        documentTitle: document.title,
        storageUri: document.latestRevision?.storageUri ?? null,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        paragraphStart: chunk.paragraphStart,
        paragraphEnd: chunk.paragraphEnd,
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        citationSpanId: chunk.citationSpans[0]?.id ?? null,
        citationQuotedText: chunk.citationSpans[0]?.quotedText ?? null,
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
            documentTitle: match.documentTitle,
            pageStart: match.pageStart,
            pageEnd: match.pageEnd,
            paragraphStart: match.paragraphStart,
            paragraphEnd: match.paragraphEnd,
            lineStart: match.lineStart,
            lineEnd: match.lineEnd
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

    if (aiConfig.hasGenerationProvider) {
      try {
        generated = await generateGroundedAnswer({
          query: parsed.data.content,
          matches: rankedMatches.map((match) => ({
            text: match.text,
            chunkIndex: match.chunkIndex,
            documentTitle: match.documentTitle,
            pageStart: match.pageStart,
            pageEnd: match.pageEnd,
            paragraphStart: match.paragraphStart,
            paragraphEnd: match.paragraphEnd,
            lineStart: match.lineStart,
            lineEnd: match.lineEnd
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
        generated?.provider === "vast-openai-compatible"
          ? renderStructuredAnswer({
              lead: generated.lead,
              bullets: generated.bullets,
              matches: rankedMatches.map((match) => ({
                documentTitle: match.documentTitle,
                pageStart: match.pageStart,
                pageEnd: match.pageEnd,
                paragraphStart: match.paragraphStart,
                paragraphEnd: match.paragraphEnd,
                lineStart: match.lineStart,
                lineEnd: match.lineEnd
              }))
            })
          : readyDocuments.length === 0
            ? "I don't have any ready documents in this collection yet. Upload and process a document first, then ask again."
          : rankedMatches.length === 0
            ? "I couldn't find grounded evidence for that question in the documents I have ready right now."
            : "I found relevant material, but the answer service is temporarily unavailable right now. Please try again in a moment.";

      const assistantState =
        generated?.provider === "vast-openai-compatible"
          ? generated.answerState
          : readyDocuments.length === 0
            ? "ingestion_pending"
          : rankedMatches.length === 0
            ? "insufficient_evidence"
            : "insufficient_evidence";

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
            generated?.provider === "vast-openai-compatible"
              ? generated.answerState === "insufficient_evidence"
                ? "model_reported_insufficient_evidence"
                : null
            : readyDocuments.length === 0
              ? "no_ready_documents"
              : rankedMatches.length === 0
                ? "no_matching_evidence"
                : generationFailureReason
                  ? generationFailureReason.slice(0, 255)
                  : null
        }
      });

      if (rankedMatches.length > 0) {
        const usedEvidenceIds =
          generated?.provider === "vast-openai-compatible"
            ? collectUsedEvidenceIds({
                lead: generated.lead,
                bullets: generated.bullets
              })
            : [];
        const selectedEvidenceSet = new Set(usedEvidenceIds);
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
              selected:
                generated?.provider === "vast-openai-compatible"
                  ? selectedEvidenceSet.has(index + 1)
                  : true
            }
          });
        }

        for (const evidenceId of usedEvidenceIds) {
          const match = rankedMatches[evidenceId - 1];

          if (!match?.citationSpanId) {
            continue;
          }

          await tx.answerCitation.create({
            data: {
              answerRecordId: answerRecord.id,
              citationSpanId: match.citationSpanId,
              citationOrder: evidenceId
            }
          });
        }

        for (const [index, match] of rankedMatches.entries()) {
          if (generated?.provider === "vast-openai-compatible") {
            continue;
          }

          if (!match.citationSpanId) {
            continue;
          }

          await tx.answerCitation.create({
            data: {
              answerRecordId: answerRecord.id,
              citationSpanId: match.citationSpanId,
              citationOrder: index + 1
            }
          });
        }
      }

      return { userMessage, assistantMessage, answerRecord };
    });

    const hydratedMessages = await prisma.message.findMany({
      where: {
        id: {
          in: [result.userMessage.id, result.assistantMessage.id]
        }
      },
      include: {
        answerRecord: {
          include: {
            citations: {
              orderBy: {
                citationOrder: "asc"
              },
              include: {
                citationSpan: {
                  include: {
                    chunk: {
                      include: {
                        documentRevision: {
                          include: {
                            document: {
                              select: {
                                id: true,
                                title: true,
                                mimeType: true
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    const userMessage = hydratedMessages.find((message) => message.id === result.userMessage.id);
    const assistantMessage = hydratedMessages.find(
      (message) => message.id === result.assistantMessage.id
    );

    return ok(
      {
        userMessage: userMessage ? serializeMessage(userMessage) : result.userMessage,
        assistantMessage: assistantMessage
          ? serializeMessage(assistantMessage)
          : result.assistantMessage,
        answerRecord: result.answerRecord
      },
      { status: 201 }
    );
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
