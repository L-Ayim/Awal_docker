import {
  generateDocumentMemoryObjects,
  generateEmbeddings,
  getAiRuntimeConfig
} from "@/lib/ai-provider";
import { chunkSectionBodies } from "@/lib/chunking";
import { extractWithRemoteDocling, shouldUseDocling } from "@/lib/document-processor";
import { detectParser, parseDocumentText } from "@/lib/ingestion-parser";
import {
  buildFallbackDocumentIndexCards,
  buildIndexCardSearchText,
  materializeGeneratedIndexCards
} from "@/lib/index-cards";
import { buildPdfCitationIndex, locateChunkInPdf } from "@/lib/pdf-citations";
import { sleepGpuRuntime } from "@/lib/gpu-runtime";
import { readStoredBytes } from "@/lib/storage";

const MEMORY_OBJECT_BATCH_SIZE = 3;
const DEFAULT_MAX_INGESTION_JOBS = 25;

function chunkArray<T>(items: T[], size: number) {
  const batches: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
}

function summarizeProviderFailure(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;

  if (/502|bad gateway/i.test(message)) {
    return "generation_runtime_unavailable";
  }

  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timeout/i.test(message)) {
    return "provider_unreachable";
  }

  return message.length > 240 ? `${message.slice(0, 237).trimEnd()}...` : message;
}

async function loadRevisionText(storageUri: string | null) {
  const stored = await readStoredBytes(storageUri);
  return stored.bytes.toString("utf8");
}

async function extractParsedDocument(params: {
  title: string;
  mimeType: string;
  sourceKind: string;
  storageUri: string | null;
}) {
  if (
    shouldUseDocling({
      mimeType: params.mimeType,
      storageUri: params.storageUri
    })
  ) {
    const doclingResult = await extractWithRemoteDocling({
      storageUri: params.storageUri,
      title: params.title,
      mimeType: params.mimeType
    });

    const parsed = parseDocumentText({
      parser: "markdown",
      title: doclingResult.title,
      text: doclingResult.markdown
    });

    return {
      ...parsed,
      parser: "docling-markdown",
      qualityNotes:
        `${doclingResult.qualityNotes} ` +
        `Normalized ${parsed.sections.length} section(s)` +
        (doclingResult.pageCount !== null ? ` across ${doclingResult.pageCount} page(s).` : ".")
    };
  }

  const rawText = await loadRevisionText(params.storageUri);
  const parser = detectParser({
    sourceKind: params.sourceKind,
    mimeType: params.mimeType,
    storageUri: params.storageUri,
    title: params.title
  });

  return parseDocumentText({
    parser,
    title: params.title,
    text: rawText
  });
}

async function loadCachedChunks(prisma: Awaited<ReturnType<typeof import("@/lib/prisma").getPrisma>>, documentRevisionId: string) {
  return prisma.chunk.findMany({
    where: {
      documentRevisionId
    },
    orderBy: {
      chunkIndex: "asc"
    },
    select: {
      id: true,
      chunkIndex: true,
      text: true,
      pageStart: true,
      pageEnd: true,
      paragraphStart: true,
      paragraphEnd: true,
      lineStart: true,
      lineEnd: true
    }
  });
}

export async function processQueuedIngestionJob() {
  const { getPrisma } = await import("@/lib/prisma");
  const prisma = getPrisma();

  const queuedJob = await prisma.ingestionJob.findFirst({
    where: {
      status: "queued"
    },
    orderBy: {
      createdAt: "asc"
    },
    include: {
      documentRevision: {
        include: {
          document: true
        }
      }
    }
  });

  if (!queuedJob) {
    return { processed: false as const, reason: "no_queued_jobs" };
  }

  const claimed = await prisma.ingestionJob.updateMany({
    where: {
      id: queuedJob.id,
      status: "queued"
    },
    data: {
      status: "processing",
      startedAt: new Date(),
      attemptCount: {
        increment: 1
      }
    }
  });

  if (claimed.count === 0) {
    return { processed: false as const, reason: "job_already_claimed" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.documentRevision.update({
      where: { id: queuedJob.documentRevisionId },
      data: {
        status: "parsing_standard"
      }
    });

    await tx.document.update({
      where: { id: queuedJob.documentRevision.documentId },
      data: {
        status: "processing"
      }
    });
  }, {
    maxWait: 10_000,
    timeout: 120_000
  });

  try {
    const cachedChunks = await loadCachedChunks(prisma, queuedJob.documentRevisionId);
    const canResumeFromCachedChunks = cachedChunks.length > 0;
    let parserName = "cached-chunks";
    let qualityNotes = `Reused ${cachedChunks.length} cached chunk(s) from the previous Docling extraction.`;
    let chunkCount = cachedChunks.length;
    let createdChunks: Array<{
      id: string;
      chunkIndex: number;
      text: string;
      pageStart: number | null;
      pageEnd: number | null;
      paragraphStart: number | null;
      paragraphEnd: number | null;
      lineStart: number | null;
      lineEnd: number | null;
    }> = cachedChunks;
    const aiConfig = getAiRuntimeConfig();
    let embeddingPayload: Awaited<ReturnType<typeof generateEmbeddings>> | null = null;
    let embeddingFailureReason: string | null = null;

    if (!canResumeFromCachedChunks) {
      const parsed = await extractParsedDocument({
        title: queuedJob.documentRevision.document.title,
        mimeType: queuedJob.documentRevision.document.mimeType,
        sourceKind: queuedJob.documentRevision.document.sourceKind,
        storageUri: queuedJob.documentRevision.storageUri
      });

      if (parsed.sections.length === 0) {
        throw new Error("No extractable text found in uploaded file.");
      }

      await prisma.documentRevision.update({
        where: { id: queuedJob.documentRevisionId },
        data: {
          status: "parsed_standard"
        }
      });

      parserName = parsed.parser;
      qualityNotes = parsed.qualityNotes;

      const chunkEntries = chunkSectionBodies(parsed.sections);
      chunkCount = chunkEntries.length;
      const citationIndex = await buildPdfCitationIndex(queuedJob.documentRevision.storageUri);
      const chunkReferences = chunkEntries.map((chunk) =>
        locateChunkInPdf(chunk.text, citationIndex)
      );

      if (aiConfig.hasEmbeddingProvider && chunkEntries.length > 0) {
        try {
          await prisma.documentRevision.update({
            where: { id: queuedJob.documentRevisionId },
            data: {
              status: "embedding"
            }
          });

          embeddingPayload = await generateEmbeddings(
            chunkEntries.map((chunk) => chunk.text),
            { runtimeKind: "ingest" }
          );
        } catch (error) {
          embeddingFailureReason =
            error instanceof Error ? error.message : "embedding_provider_failed";
        }
      }

      await prisma.documentIndexCard.deleteMany({
        where: {
          documentRevisionId: queuedJob.documentRevisionId
        }
      });

      await prisma.chunk.deleteMany({
        where: {
          documentRevisionId: queuedJob.documentRevisionId
        }
      });

      await prisma.documentSection.deleteMany({
        where: {
          documentRevisionId: queuedJob.documentRevisionId
        }
      });

      const sectionIdByPath = new Map<string, string>();

      for (const section of parsed.sections) {
        const createdSection = await prisma.documentSection.create({
          data: {
            documentRevisionId: queuedJob.documentRevisionId,
            sectionPath: section.sectionPath,
            heading: section.heading,
            ordinal: section.ordinal
          }
        });

        sectionIdByPath.set(section.sectionPath, createdSection.id);
      }

      createdChunks = [];

      for (const [index, chunk] of chunkEntries.entries()) {
        const reference = chunkReferences[index];
        const createdChunk = await prisma.chunk.create({
          data: {
            documentRevisionId: queuedJob.documentRevisionId,
            sectionId: sectionIdByPath.get(chunk.sectionPath) ?? null,
            chunkIndex: index,
            text: chunk.text,
            tokenCount: chunk.text.split(/\s+/).filter(Boolean).length,
            charCount: chunk.text.length,
            pageStart: reference?.pageStart ?? null,
            pageEnd: reference?.pageEnd ?? null,
            paragraphStart: reference?.paragraphStart ?? null,
            paragraphEnd: reference?.paragraphEnd ?? null,
            lineStart: reference?.lineStart ?? null,
            lineEnd: reference?.lineEnd ?? null,
            searchText: chunk.text.toLowerCase()
          }
        });

        if (reference) {
          await prisma.citationSpan.create({
            data: {
              chunkId: createdChunk.id,
              startChar: 0,
              endChar: Math.max(1, Math.min(chunk.text.length, reference.quotedText.length)),
              quotedText: reference.quotedText,
              pageStart: reference.pageStart,
              pageEnd: reference.pageEnd,
              paragraphStart: reference.paragraphStart,
              paragraphEnd: reference.paragraphEnd,
              lineStart: reference.lineStart,
              lineEnd: reference.lineEnd
            }
          });
        }

        createdChunks.push({
          id: createdChunk.id,
          chunkIndex: index,
          text: chunk.text,
          pageStart: reference?.pageStart ?? null,
          pageEnd: reference?.pageEnd ?? null,
          paragraphStart: reference?.paragraphStart ?? null,
          paragraphEnd: reference?.paragraphEnd ?? null,
          lineStart: reference?.lineStart ?? null,
          lineEnd: reference?.lineEnd ?? null
        });
      }

      if (embeddingPayload) {
        for (const createdChunk of createdChunks) {
          const vector = embeddingPayload.data.find(
            (entry) => entry.index === createdChunk.chunkIndex
          );

          if (!vector) {
            continue;
          }

          await prisma.chunkEmbedding.create({
            data: {
              chunkId: createdChunk.id,
              modelName: embeddingPayload.model,
              dimensions: embeddingPayload.dimensions,
              vectorJson: vector.embedding
            }
          });
        }
      }
    } else {
      await prisma.documentRevision.update({
        where: { id: queuedJob.documentRevisionId },
        data: {
          status: "parsed_standard"
        }
      });

      await prisma.documentIndexCard.deleteMany({
        where: {
          documentRevisionId: queuedJob.documentRevisionId
        }
      });
    }

    const chunkInputs = createdChunks.map((chunk) => ({
      ...chunk,
      documentTitle: queuedJob.documentRevision.document.title
    }));
    await sleepGpuRuntime({ kind: "ingest" }).catch(() => undefined);

    let generatedMemoryObjects: Array<{
      chunkIndex: number;
      kind: string;
      title: string;
      body: string;
      summary: string;
      tags: string[];
      aliases: string[];
    }> = [];
    let memoryObjectModelName: string | null = null;
    let memoryObjectFailureReason: string | null = null;

    if (aiConfig.hasGenerationProvider && chunkInputs.length > 0) {
      try {
        await prisma.documentRevision.update({
          where: { id: queuedJob.documentRevisionId },
          data: {
            status: "normalizing"
          }
        });

        const batches = chunkArray(chunkInputs, MEMORY_OBJECT_BATCH_SIZE);

        // Run semantic memory generation only after Docling extraction and ingest embeddings finish.
        for (const batch of batches) {
          const generated = await generateDocumentMemoryObjects({
            documentTitle: queuedJob.documentRevision.document.title,
            wakeGenerationRuntime: true,
            allowStaticGenerationProvider: true,
            chunks: batch.map((chunk) => ({
              chunkIndex: chunk.chunkIndex,
              text: chunk.text,
              pageStart: chunk.pageStart,
              pageEnd: chunk.pageEnd,
              paragraphStart: chunk.paragraphStart,
              paragraphEnd: chunk.paragraphEnd,
              lineStart: chunk.lineStart,
              lineEnd: chunk.lineEnd
            }))
          });

          generatedMemoryObjects.push(...generated.objects);
          memoryObjectModelName = generated.modelName;
        }
      } catch (error) {
        memoryObjectFailureReason = summarizeProviderFailure(
          error,
          "memory_object_generation_failed"
        );
      }
    }

    if (aiConfig.hasGenerationProvider && chunkInputs.length > 0 && generatedMemoryObjects.length === 0) {
      throw new Error(
        memoryObjectFailureReason
          ? `Semantic memory generation failed: ${memoryObjectFailureReason}`
          : "Semantic memory generation did not return any objects."
      );
    }

    const indexCards =
      generatedMemoryObjects.length > 0
        ? materializeGeneratedIndexCards({
            documentTitle: queuedJob.documentRevision.document.title,
            chunks: chunkInputs,
            generatedObjects: generatedMemoryObjects
          })
        : buildFallbackDocumentIndexCards({
            documentTitle: queuedJob.documentRevision.document.title,
            chunks: chunkInputs
          });
    let indexCardEmbeddingPayload: Awaited<ReturnType<typeof generateEmbeddings>> | null = null;
    let indexCardEmbeddingFailureReason: string | null = null;

    if (aiConfig.hasEmbeddingProvider && indexCards.length > 0) {
      try {
        indexCardEmbeddingPayload = await generateEmbeddings(
          indexCards.map((card) =>
            buildIndexCardSearchText({
              title: card.title,
              body: card.body,
              summary: card.summary,
              tags: card.tags,
              aliases: card.aliases
            })
          ),
          { runtimeKind: "ingest" }
        );
      } catch (error) {
        indexCardEmbeddingFailureReason =
          error instanceof Error ? error.message : "index_card_embedding_provider_failed";
      }
    }

    for (const [index, card] of indexCards.entries()) {
      const createdCard = await prisma.documentIndexCard.create({
        data: {
          documentRevisionId: queuedJob.documentRevisionId,
          chunkId: card.chunkId,
          kind: card.kind,
          title: card.title,
          body: card.body,
          summary: card.summary,
          tagsJson: card.tags,
          aliasesJson: card.aliases,
          searchText: buildIndexCardSearchText(card),
          pageStart: card.pageStart,
          pageEnd: card.pageEnd,
          paragraphStart: card.paragraphStart,
          paragraphEnd: card.paragraphEnd,
          lineStart: card.lineStart,
          lineEnd: card.lineEnd
        }
      });

      const vector = indexCardEmbeddingPayload?.data.find((entry) => entry.index === index);

      if (!vector || !indexCardEmbeddingPayload) {
        continue;
      }

      await prisma.documentIndexCardEmbedding.create({
        data: {
          indexCardId: createdCard.id,
          modelName: indexCardEmbeddingPayload.model,
          dimensions: indexCardEmbeddingPayload.dimensions,
          vectorJson: vector.embedding
        }
      });
    }

    await prisma.documentRevision.update({
      where: { id: queuedJob.documentRevisionId },
      data: {
        status: "ready",
        extractionQuality: "medium",
        reviewFlag: false,
        qualityNotes:
          `${qualityNotes} Generated ${chunkCount} chunks with the ${parserName} parser.` +
          (embeddingPayload
            ? ` Embedded ${embeddingPayload.data.length} chunk(s) with ${embeddingPayload.model}.`
            : embeddingFailureReason
              ? ` Embedding skipped: ${embeddingFailureReason}.`
              : "") +
          (generatedMemoryObjects.length > 0
            ? ` Generated ${generatedMemoryObjects.length} semantic memory object(s)` +
              (memoryObjectModelName ? ` with ${memoryObjectModelName}` : "") +
              ` and materialized ${indexCards.length} index card(s).`
            : memoryObjectFailureReason
              ? ` Semantic memory generation skipped: ${memoryObjectFailureReason}. Built ${indexCards.length} heuristic index card(s).`
              : ` Built ${indexCards.length} heuristic index card(s).`) +
          (indexCardEmbeddingPayload
            ? ` Embedded ${indexCardEmbeddingPayload.data.length} index card(s) with ${indexCardEmbeddingPayload.model}.`
            : indexCardEmbeddingFailureReason
              ? ` Index card embedding skipped: ${indexCardEmbeddingFailureReason}.`
              : "")
      }
    });

    await prisma.document.update({
      where: { id: queuedJob.documentRevision.documentId },
      data: {
        status: "ready",
        latestRevisionId: queuedJob.documentRevisionId
      }
    });

    await prisma.ingestionJob.update({
      where: { id: queuedJob.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        lastError: null
      }
    });

    return {
      processed: true as const,
      jobId: queuedJob.id,
      revisionId: queuedJob.documentRevisionId
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ingestion failed.";

    await prisma.$transaction(async (tx) => {
      await tx.documentRevision.update({
        where: { id: queuedJob.documentRevisionId },
        data: {
          status: "failed",
          reviewFlag: true,
          qualityNotes: message
        }
      });

      await tx.document.update({
        where: { id: queuedJob.documentRevision.documentId },
        data: {
          status: "failed"
        }
      });

      await tx.ingestionJob.update({
        where: { id: queuedJob.id },
        data: {
          status: "failed",
          completedAt: new Date(),
          lastError: message
        }
      });
    }, {
      maxWait: 10_000,
      timeout: 120_000
    });

    return {
      processed: false as const,
      reason: "processing_failed",
      error: message,
      jobId: queuedJob.id,
      revisionId: queuedJob.documentRevisionId
    };
  }
}

export async function processQueuedIngestionJobs(params: { maxJobs?: number } = {}) {
  const maxJobs = params.maxJobs ?? DEFAULT_MAX_INGESTION_JOBS;
  const results: Array<Awaited<ReturnType<typeof processQueuedIngestionJob>>> = [];

  for (let index = 0; index < maxJobs; index += 1) {
    const result = await processQueuedIngestionJob();
    results.push(result);

    if (!result.processed && result.reason !== "job_already_claimed") {
      break;
    }
  }

  const processedCount = results.filter((result) => result.processed).length;
  const terminal = results.at(-1);

  return {
    processed: processedCount > 0,
    processedCount,
    maxJobs,
    reason: terminal && !terminal.processed ? terminal.reason : null,
    results
  };
}
