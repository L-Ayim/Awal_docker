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
  hybridScore: number;
  rerankScore: number | null;
};

function capPerDocument<T extends { documentId: string }>(items: T[], limit: number, perDocument: number) {
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

function tokenize(text: string) {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
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
  const queryTokens = tokenize(params.query);
  const limit = params.limit ?? 8;
  const ranked = params.chunks
    .map((chunk) => {
      const haystack = normalize(chunk.text);
      let lexicalScore = 0;

      for (const token of queryTokens) {
        if (haystack.includes(token)) {
          lexicalScore += 1;
        }
      }

      const normalizedLexical = queryTokens.length > 0 ? lexicalScore / queryTokens.length : 0;
      const denseScore =
        params.queryEmbedding && chunk.embedding
          ? cosineSimilarity(params.queryEmbedding, chunk.embedding)
          : null;
      const hybridScore =
        normalizedLexical * (denseScore !== null ? 0.45 : 0.85) +
        Math.max(denseScore ?? 0, 0) * (denseScore !== null ? 0.55 : 0.15);

      return {
        ...chunk,
        lexicalScore,
        denseScore,
        hybridScore,
        rerankScore: null
      } satisfies RankedChunk;
    })
    .filter((chunk) => chunk.lexicalScore > 0 || (chunk.denseScore ?? 0) >= 0.35)
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
  const snippets = params.matches.map((match, index) => {
    const excerpt =
      match.text.length > 260 ? `${match.text.slice(0, 257).trimEnd()}...` : match.text;
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

    return `${index + 1}. ${match.documentTitle}${locations ? ` (${locations})` : ""}: ${excerpt}`;
  });

  return [
    "Here’s the most relevant material I found in the processed documents.",
    "",
    "Grounded snippets:",
    ...snippets
  ].join("\n");
}
