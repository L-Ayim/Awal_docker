type ChunkCandidate = {
  id: string;
  text: string;
  chunkIndex: number;
  documentId: string;
  documentRevisionId: string;
  documentTitle: string;
  storageUri: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  paragraphStart: number | null;
  paragraphEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  citationSpanId: string | null;
  citationQuotedText: string | null;
  embedding: number[] | null;
};

type RankedChunk = ChunkCandidate & {
  denseScore: number | null;
  lexicalScore: number;
  titleScore: number;
  phraseScore: number;
  hybridScore: number;
  rerankScore: number | null;
};

function capPerDocument<T extends { documentId: string }>(
  items: T[],
  limit: number,
  perDocument: number
) {
  const counts = new Map<string, number>();
  const selected: T[] = [];

  for (const item of items) {
    const count = counts.get(item.documentId) ?? 0;

    if (count >= perDocument) {
      continue;
    }

    selected.push(item);
    counts.set(item.documentId, count + 1);

    if (selected.length >= limit) {
      break;
    }
  }

  if (selected.length >= limit) {
    return selected;
  }

  for (const item of items) {
    if (selected.includes(item)) {
      continue;
    }

    selected.push(item);

    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function normalize(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

const STOP_WORDS = new Set([
  "a",
  "about",
  "an",
  "and",
  "are",
  "can",
  "do",
  "does",
  "for",
  "give",
  "hello",
  "help",
  "hey",
  "hi",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "ok",
  "okay",
  "on",
  "or",
  "please",
  "say",
  "tell",
  "thanks",
  "thank",
  "that",
  "the",
  "their",
  "there",
  "they",
  "this",
  "to",
  "us",
  "using",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "you",
  "your"
]);

function tokenize(text: string) {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function countAlphaNumeric(text: string) {
  return (text.match(/[a-z0-9]/gi) ?? []).length;
}

function isWeakChunkText(text: string) {
  const withoutImageMarkers = text.replace(/<!--\s*image\s*-->/gi, " ");
  const alphaNumericChars = countAlphaNumeric(withoutImageMarkers);
  const imageMarkers = (text.match(/<!--\s*image\s*-->/gi) ?? []).length;
  const normalizedText = normalize(withoutImageMarkers);
  const looksLikeRelatedDocsBoilerplate =
    normalizedText.includes("the following policies and procedures are relevant to this document");
  const looksLikeDocumentMetadataTable =
    normalizedText.includes("document id") &&
    normalizedText.includes("document name") &&
    normalizedText.includes("document owner");

  return (
    alphaNumericChars < 120 ||
    (imageMarkers > 0 && alphaNumericChars < 220) ||
    looksLikeRelatedDocsBoilerplate ||
    looksLikeDocumentMetadataTable
  );
}

function computeTokenOverlapScore(queryTokens: string[], candidateText: string) {
  if (queryTokens.length === 0) {
    return 0;
  }

  const candidateTokens = new Set(tokenize(candidateText));
  let overlap = 0;

  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / queryTokens.length;
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export function rankChunks(params: {
  query: string;
  chunks: ChunkCandidate[];
  queryEmbedding?: number[] | null;
  limit?: number;
}) {
  const normalizedQuery = normalize(params.query);
  const queryTokens = tokenize(params.query);

  if (queryTokens.length === 0) {
    return [];
  }

  const limit = params.limit ?? 8;
  const ranked = params.chunks
    .filter((chunk) => !isWeakChunkText(chunk.text))
    .map((chunk) => {
      const haystack = normalize(chunk.text);
      let lexicalScore = 0;

      for (const token of queryTokens) {
        if (haystack.includes(token)) {
          lexicalScore += 1;
        }
      }

      const normalizedLexical = queryTokens.length > 0 ? lexicalScore / queryTokens.length : 0;
      const titleScore = computeTokenOverlapScore(queryTokens, chunk.documentTitle);
      const phraseScore =
        normalizedQuery.length >= 10 &&
        (haystack.includes(normalizedQuery) || normalize(chunk.documentTitle).includes(normalizedQuery))
          ? 1
          : 0;
      const denseScore =
        params.queryEmbedding && chunk.embedding
          ? cosineSimilarity(params.queryEmbedding, chunk.embedding)
          : null;
      const hybridScore =
        normalizedLexical * (denseScore !== null ? 0.35 : 0.55) +
        titleScore * 0.3 +
        phraseScore * 0.25 +
        Math.max(denseScore ?? 0, 0) * (denseScore !== null ? 0.1 : 0);

      return {
        ...chunk,
        lexicalScore,
        titleScore,
        phraseScore,
        denseScore,
        hybridScore,
        rerankScore: null
      } satisfies RankedChunk;
    })
    .filter(
      (chunk) =>
        chunk.lexicalScore > 0 ||
        chunk.titleScore >= 0.34 ||
        chunk.phraseScore > 0 ||
        (chunk.denseScore ?? 0) >= 0.35
    )
    .sort((left, right) => right.hybridScore - left.hybridScore);

  return capPerDocument(ranked, limit, 2);
}

export function applyRerankScores(params: {
  matches: RankedChunk[];
  rerankScores: Array<{
    index: number;
    score: number;
  }>;
  limit?: number;
}) {
  const rerankScoreByIndex = new Map(
    params.rerankScores.map((entry) => [entry.index, entry.score] as const)
  );
  const limit = params.limit ?? 5;
  const ranked = params.matches
    .map((match, index) => ({
      ...match,
      rerankScore: rerankScoreByIndex.get(index) ?? null
    }))
    .sort((left, right) => {
      const leftScore = left.rerankScore ?? left.hybridScore;
      const rightScore = right.rerankScore ?? right.hybridScore;
      return rightScore - leftScore;
    });

  return capPerDocument(ranked, limit, 2);
}

export function composeGroundedAnswer(params: {
  query: string;
  matches: Array<{
    text: string;
    chunkIndex: number;
    documentTitle: string;
    pageStart: number | null;
    pageEnd: number | null;
    paragraphStart: number | null;
    paragraphEnd: number | null;
    lineStart: number | null;
    lineEnd: number | null;
  }>;
}) {
  const snippets = params.matches.slice(0, 3).map((match, index) => {
    const cleanedText = match.text
      .replace(/<!--\s*image\s*-->/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const firstSentence = cleanedText.split(/(?<=[.!?])\s+/).find(Boolean) ?? cleanedText;
    const excerpt = firstSentence.slice(0, 240).trimEnd();
    const locations = [
      match.pageStart !== null
        ? match.pageEnd !== null && match.pageEnd !== match.pageStart
          ? `pages ${match.pageStart}-${match.pageEnd}`
          : `page ${match.pageStart}`
        : null,
      match.paragraphStart !== null
        ? match.paragraphEnd !== null && match.paragraphEnd !== match.paragraphStart
          ? `paragraphs ${match.paragraphStart}-${match.paragraphEnd}`
          : `paragraph ${match.paragraphStart}`
        : null,
      match.lineStart !== null
        ? match.lineEnd !== null && match.lineEnd !== match.lineStart
          ? `lines ${match.lineStart}-${match.lineEnd}`
          : `line ${match.lineStart}`
        : null
    ]
      .filter(Boolean)
      .join(", ");

    return `- ${excerpt}${excerpt.endsWith(".") ? "" : "."} [${index + 1}]${locations ? ` (${locations})` : ""}`;
  });

  return [
    "I found grounded evidence in the processed documents, but the answer generator was unavailable, so here are the strongest supporting points.",
    "",
    ...snippets
  ].join("\n");
}
