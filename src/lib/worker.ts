import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { generateEmbeddings, getAiRuntimeConfig } from "@/lib/ai-provider";
import { chunkSectionBodies } from "@/lib/chunking";
import { extractWithRemoteDocling, shouldUseDocling } from "@/lib/document-processor";
import { detectParser, parseDocumentText } from "@/lib/ingestion-parser";
import { buildPdfCitationIndex, locateChunkInPdf } from "@/lib/pdf-citations";

async function loadRevisionText(storageUri: string | null) {
  if (!storageUri || !storageUri.startsWith("file://")) {
    throw new Error("Unsupported storage URI.");
  }

  const absolutePath = fileURLToPath(storageUri);
  const buffer = await readFile(absolutePath);
  return buffer.toString("utf8");
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

  await prisma.$transaction(async (tx) => {
    await tx.ingestionJob.update({
      where: { id: queuedJob.id },
      data: {
        status: "processing",
        startedAt: new Date(),
        attemptCount: {
          increment: 1
        }
      }
    });

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
    const parsed = await extractParsedDocument({
      title: queuedJob.documentRevision.document.title,
      mimeType: queuedJob.documentRevision.document.mimeType,
      sourceKind: queuedJob.documentRevision.document.sourceKind,
      storageUri: queuedJob.documentRevision.storageUri
    });

    if (parsed.sections.length === 0) {
      throw new Error("No extractable text found in uploaded file.");
    }

    const chunkEntries = chunkSectionBodies(parsed.sections);
    const citationIndex = await buildPdfCitationIndex(queuedJob.documentRevision.storageUri);
    const chunkReferences = chunkEntries.map((chunk) =>
      locateChunkInPdf(chunk.text, citationIndex)
    );
    const aiConfig = getAiRuntimeConfig();
    let embeddingPayload: Awaited<ReturnType<typeof generateEmbeddings>> | null = null;
    let embeddingFailureReason: string | null = null;

    if (aiConfig.hasEmbeddingProvider && chunkEntries.length > 0) {
      try {
        embeddingPayload = await generateEmbeddings(chunkEntries.map((chunk) => chunk.text));
      } catch (error) {
        embeddingFailureReason =
          error instanceof Error ? error.message : "embedding_provider_failed";
      }
    }

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

    const createdChunks: Array<{
      id: string;
      chunkIndex: number;
    }> = [];

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
        chunkIndex: index
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

    await prisma.documentRevision.update({
      where: { id: queuedJob.documentRevisionId },
      data: {
        status: "ready",
        extractionQuality: "medium",
        reviewFlag: false,
        qualityNotes:
          `${parsed.qualityNotes} Generated ${chunkEntries.length} chunks with the ${parsed.parser} parser.` +
          (embeddingPayload
            ? ` Embedded ${embeddingPayload.data.length} chunk(s) with ${embeddingPayload.model}.`
            : embeddingFailureReason
              ? ` Embedding skipped: ${embeddingFailureReason}.`
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
