type ChunkCandidate = {
  id: string;
  text: string;
  chunkIndex: number;
  documentRevisionId: string;
  documentTitle: string;
  embedding: number[] | null;
};

type RankedChunk = ChunkCandidate & {
  denseScore: number | null;
  lexicalScore: number;
  hybridScore: number;
  rerankScore: number | null;
};

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

  return params.chunks
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
    .sort((left, right) => right.hybridScore - left.hybridScore)
    .slice(0, limit);
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

  return params.matches
    .map((match, index) => ({
      ...match,
      rerankScore: rerankScoreByIndex.get(index) ?? null
    }))
    .sort((left, right) => {
      const leftScore = left.rerankScore ?? left.hybridScore;
      const rightScore = right.rerankScore ?? right.hybridScore;
      return rightScore - leftScore;
    })
    .slice(0, limit);
}

export function composeGroundedAnswer(params: {
  query: string;
  matches: Array<{
    text: string;
    chunkIndex: number;
    documentTitle: string;
  }>;
}) {
  const snippets = params.matches.map((match, index) => {
    const excerpt =
      match.text.length > 260 ? `${match.text.slice(0, 257).trimEnd()}...` : match.text;

    return `${index + 1}. ${match.documentTitle}, chunk ${match.chunkIndex + 1}: ${excerpt}`;
  });

  return [
    "I found relevant material in the processed document set.",
    "",
    "Grounded snippets:",
    ...snippets
  ].join("\n");
}
