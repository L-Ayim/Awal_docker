import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { badRequest, notFound, ok, serverError, validationError } from "@/lib/api";
import {
  generateEmbeddings,
  generateGroundedAnswer,
  getAiRuntimeConfig,
  rerankEvidence
} from "@/lib/ai-provider";
import { buildQueryProfile } from "@/lib/query-understanding";
import { applyRerankScores, rankChunks } from "@/lib/retrieval";

const createMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000)
});

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

function encodeSseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function splitAssistantStreamChunks(content: string) {
  const chunks =
    content.match(/[^.!?\n]+(?:[.!?]+["')\]]*|\n|$)/g)?.map((chunk) => chunk.trimStart()) ?? [];

  return chunks.filter(Boolean);
}

function createMessageStream(params: {
  requestUrl: string;
  content: string;
}) {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(encodeSseEvent(event, data)));

      try {
        send("status", { stage: "queued" });
        send("status", { stage: "generating" });

        const url = new URL(params.requestUrl);
        url.searchParams.delete("stream");

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            content: params.content
          })
        });

        const payload = (await response.json().catch(() => null)) as
          | {
              userMessage?: unknown;
              assistantMessage?: {
                content?: string;
              };
            }
          | { message?: string }
          | null;

        if (!response.ok) {
          const message =
            payload && "message" in payload && typeof payload.message === "string"
              ? payload.message
              : "Failed to create conversation message.";

          send("error", { message });
          return;
        }

        if (!payload || !("userMessage" in payload) || !("assistantMessage" in payload)) {
          send("error", { message: "Failed to stream conversation message." });
          return;
        }

        send("user_message", payload.userMessage);
        send("status", { stage: "streaming" });

        const chunks = splitAssistantStreamChunks(payload.assistantMessage?.content ?? "");

        for (const chunk of chunks) {
          send("assistant_delta", { delta: chunk });
          await new Promise((resolve) => setTimeout(resolve, 18));
        }

        send("done", payload);
      } catch (streamError) {
        send("error", {
          message:
            streamError instanceof Error ? streamError.message : "Streaming failed."
        });
      } finally {
        controller.close();
      }
    }
  });
}

function createSseResponse(stream: ReadableStream) {
  return new Response(stream, {
    status: 201,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
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
  const lead = params.lead.text.trim();

  const bullets = params.bullets
    .map((bullet) => {
      const text = bullet.text.trim();

      if (!text) {
        return null;
      }

      return `- ${text}`.trim();
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

function buildFallbackEvidenceIds(params: {
  generated: Awaited<ReturnType<typeof generateGroundedAnswer>> | null;
  matchCount: number;
}) {
  if (
    params.generated?.provider !== "vast-openai-compatible" ||
    params.generated.responseKind !== "grounded" ||
    params.generated.answerState !== "grounded_answer" ||
    params.matchCount === 0
  ) {
    return [];
  }

  return Array.from({ length: Math.min(params.matchCount, 3) }, (_, index) => index + 1);
}

function buildContextualQuery(params: {
  currentQuestion: string;
  previousMessages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;
}) {
  const recentMessages = params.previousMessages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-6)
    .map((message) => {
      const role = message.role === "assistant" ? "Awal" : "User";
      const content = message.content.replace(/\s+/g, " ").trim().slice(0, 700);

      return content ? `${role}: ${content}` : null;
    })
    .filter(Boolean);

  if (recentMessages.length === 0) {
    return params.currentQuestion;
  }

  return [
    "Use the recent conversation only to resolve follow-up references like 'that', 'there', 'names', or 'it'.",
    "Recent conversation:",
    ...recentMessages,
    "",
    `Current user question: ${params.currentQuestion}`
  ].join("\n");
}

function buildRetrievalQuery(params: {
  currentQuestion: string;
  previousMessages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;
}) {
  const previousUserQuestion = [...params.previousMessages]
    .reverse()
    .find((message) => message.role === "user" && message.content.trim() !== params.currentQuestion);

  if (!previousUserQuestion) {
    return params.currentQuestion;
  }

  return [
    params.currentQuestion,
    `Previous user topic: ${previousUserQuestion.content.replace(/\s+/g, " ").trim().slice(0, 220)}`
  ].join("\n");
}

async function ensureCitationSpan(params: {
  tx: Prisma.TransactionClient;
  match: {
    id: string;
    text: string;
    citationSpanId: string | null;
    citationQuotedText: string | null;
    pageStart: number | null;
    pageEnd: number | null;
    paragraphStart: number | null;
    paragraphEnd: number | null;
    lineStart: number | null;
    lineEnd: number | null;
  };
}) {
  if (params.match.citationSpanId) {
    return params.match.citationSpanId;
  }

  const quotedText =
    params.match.citationQuotedText?.trim() ||
    (params.match.text.length > 360
      ? `${params.match.text.slice(0, 357).trimEnd()}...`
      : params.match.text);

  const citationSpan = await params.tx.citationSpan.create({
    data: {
      chunkId: params.match.id,
      startChar: 0,
      endChar: Math.min(params.match.text.length, quotedText.length),
      quotedText,
      pageStart: params.match.pageStart,
      pageEnd: params.match.pageEnd,
      paragraphStart: params.match.paragraphStart,
      paragraphEnd: params.match.paragraphEnd,
      lineStart: params.match.lineStart,
      lineEnd: params.match.lineEnd
    }
  });

  return citationSpan.id;
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
          pageStart: number | null;
          pageEnd: number | null;
          paragraphStart: number | null;
          paragraphEnd: number | null;
          lineStart: number | null;
          lineEnd: number | null;
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
          citations: message.answerRecord.citations.map((citation) => {
            const location = {
              pageStart: citation.citationSpan.pageStart ?? citation.citationSpan.chunk.pageStart,
              pageEnd: citation.citationSpan.pageEnd ?? citation.citationSpan.chunk.pageEnd,
              paragraphStart:
                citation.citationSpan.paragraphStart ?? citation.citationSpan.chunk.paragraphStart,
              paragraphEnd:
                citation.citationSpan.paragraphEnd ?? citation.citationSpan.chunk.paragraphEnd,
              lineStart: citation.citationSpan.lineStart ?? citation.citationSpan.chunk.lineStart,
              lineEnd: citation.citationSpan.lineEnd ?? citation.citationSpan.chunk.lineEnd
            };

            return {
              citationOrder: citation.citationOrder,
              quotedText: citation.citationSpan.quotedText,
              locationLabel: formatLocationLabel(location),
              ...location,
              document: {
                id: citation.citationSpan.chunk.documentRevision.document.id,
                title: citation.citationSpan.chunk.documentRevision.document.title,
                mimeType: citation.citationSpan.chunk.documentRevision.document.mimeType
              }
            };
          })
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
    const streamResponse = new URL(request.url).searchParams.get("stream") === "1";
    const json = await request.json();
    const parsed = createMessageSchema.safeParse(json);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    if (streamResponse) {
      return createSseResponse(
        createMessageStream({
          requestUrl: request.url,
          content: parsed.data.content
        })
      );
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: {
            createdAt: "desc"
          },
          take: 8,
          select: {
            role: true,
            content: true
          }
        },
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
                    },
                    indexCards: {
                      include: {
                        embedding: true,
                        chunk: {
                          include: {
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
        evidenceSource: "chunk" as const,
        cardKind: null,
        cardTitle: null,
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
    const candidateIndexCards = readyDocuments.flatMap((document) =>
      (document.latestRevision?.indexCards ?? [])
        .filter((card) => card.chunkId && card.chunk)
        .map((card) => {
          const aliases = Array.isArray(card.aliasesJson)
            ? card.aliasesJson.filter((value): value is string => typeof value === "string")
            : [];
          const tags = Array.isArray(card.tagsJson)
            ? card.tagsJson.filter((value): value is string => typeof value === "string")
            : [];
          const chunk = card.chunk!;
          const evidenceText = [
            `Kind: ${card.kind}`,
            card.title,
            card.summary,
            card.body,
            aliases.length > 0 ? `Aliases: ${aliases.join(", ")}` : null,
            tags.length > 0 ? `Tags: ${tags.join(", ")}` : null
          ]
            .filter(Boolean)
            .join("\n");

          return {
            id: chunk.id,
            text: evidenceText,
            chunkIndex: chunk.chunkIndex,
            evidenceSource: "index_card" as const,
            cardKind: card.kind,
            cardTitle: card.title,
            documentId: document.id,
            documentRevisionId: chunk.documentRevisionId,
            documentTitle: document.title,
            storageUri: document.latestRevision?.storageUri ?? null,
            pageStart: card.pageStart ?? chunk.pageStart,
            pageEnd: card.pageEnd ?? chunk.pageEnd,
            paragraphStart: card.paragraphStart ?? chunk.paragraphStart,
            paragraphEnd: card.paragraphEnd ?? chunk.paragraphEnd,
            lineStart: card.lineStart ?? chunk.lineStart,
            lineEnd: card.lineEnd ?? chunk.lineEnd,
            citationSpanId: chunk.citationSpans[0]?.id ?? null,
            citationQuotedText: chunk.citationSpans[0]?.quotedText ?? null,
            embedding: Array.isArray(card.embedding?.vectorJson)
              ? (card.embedding?.vectorJson as number[])
              : null
          };
        })
    );
    const evidenceCandidates = [...candidateIndexCards, ...candidateChunks];

    const contextualQuery = buildContextualQuery({
      currentQuestion: parsed.data.content,
      previousMessages: [...conversation.messages].reverse()
    });
    const queryProfile = buildQueryProfile(parsed.data.content);
    const retrievalQuery = buildRetrievalQuery({
      currentQuestion: queryProfile.retrievalQuery,
      previousMessages: [...conversation.messages].reverse()
    });
    const aiConfig = getAiRuntimeConfig();
    let queryEmbedding: number[] | null = null;
    let rerankResult: Awaited<ReturnType<typeof rerankEvidence>> | null = null;

    if (aiConfig.hasEmbeddingProvider && evidenceCandidates.some((chunk) => chunk.embedding)) {
      try {
        queryEmbedding = (await generateEmbeddings([retrievalQuery])).data[0]?.embedding ?? null;
      } catch {
        queryEmbedding = null;
      }
    }

    const initialMatches = rankChunks({
      query: retrievalQuery,
      chunks: evidenceCandidates,
      queryEmbedding,
      preferredCardKinds: queryProfile.preferredCardKinds,
      limit: 10
    });

    if (aiConfig.hasRerankProvider && initialMatches.length > 0) {
      try {
        rerankResult = await rerankEvidence({
          query: retrievalQuery,
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
          limit: 8
        })
      : initialMatches.slice(0, 8);

    let generated:
      | Awaited<ReturnType<typeof generateGroundedAnswer>>
      | null = null;
    let generationFailureReason: string | null = null;

    if (aiConfig.hasGenerationProvider) {
      try {
        generated = await generateGroundedAnswer({
          query: contextualQuery,
          queryProfile,
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

      const generatedAnswer =
        generated?.provider === "vast-openai-compatible" ? generated : null;
      const assistantContent =
        generatedAnswer
          ? renderStructuredAnswer({
              lead: generatedAnswer.lead,
              bullets: generatedAnswer.bullets,
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
            : generationFailureReason
              ? "Awal could not finish starting the 32B runtime for this request. Please try again in a moment."
              : "Awal could not generate an answer for this request. Please try again in a moment.";

      const assistantState =
        generatedAnswer
          ? generatedAnswer.answerState
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
            generatedAnswer
              ? generatedAnswer.answerState === "insufficient_evidence"
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
          generatedAnswer
            ? collectUsedEvidenceIds({
                lead: generatedAnswer.lead,
                bullets: generatedAnswer.bullets
              })
            : [];
        const selectedEvidenceSet = new Set(usedEvidenceIds);
        const retrievalTrace = await tx.retrievalTrace.create({
          data: {
            conversationId,
            messageId: assistantMessage.id,
            queryText: retrievalQuery,
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
              selected: generatedAnswer ? selectedEvidenceSet.has(index + 1) : false
            }
          });
        }

        const citationEvidenceIds = generatedAnswer
          ? usedEvidenceIds.length > 0
            ? usedEvidenceIds
            : buildFallbackEvidenceIds({
                generated: generatedAnswer,
                matchCount: rankedMatches.length
              })
          : [];

        for (const evidenceId of citationEvidenceIds) {
          const match = rankedMatches[evidenceId - 1];

          if (!match) {
            continue;
          }

          const citationSpanId = await ensureCitationSpan({
            tx,
            match
          });

          await tx.answerCitation.create({
            data: {
              answerRecordId: answerRecord.id,
              citationSpanId,
              citationOrder: evidenceId
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

    const payload = {
      userMessage: userMessage ? serializeMessage(userMessage) : result.userMessage,
      assistantMessage: assistantMessage
        ? serializeMessage(assistantMessage)
        : result.assistantMessage,
      answerRecord: result.answerRecord
    };

    if (!streamResponse) {
      return ok(payload, { status: 201 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) =>
          controller.enqueue(encoder.encode(encodeSseEvent(event, data)));

        try {
          send("status", { stage: "queued" });
          send("user_message", payload.userMessage);
          send("status", { stage: "generating" });
          send("status", { stage: "streaming" });

          const chunks = splitAssistantStreamChunks(payload.assistantMessage.content);

          for (const chunk of chunks) {
            send("assistant_delta", { delta: chunk });
            await new Promise((resolve) => setTimeout(resolve, 18));
          }

          send("done", payload);
        } catch (streamError) {
          send("error", {
            message:
              streamError instanceof Error ? streamError.message : "Streaming failed."
          });
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      status: 201,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    });
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
