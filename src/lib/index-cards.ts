export type ChunkInput = {
  id: string;
  text: string;
  chunkIndex: number;
  documentTitle: string;
  pageStart: number | null;
  pageEnd: number | null;
  paragraphStart: number | null;
  paragraphEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
};

export type IndexCardInput = {
  chunkId: string;
  kind: string;
  title: string;
  body: string;
  summary: string;
  tags: string[];
  aliases: string[];
  pageStart: number | null;
  pageEnd: number | null;
  paragraphStart: number | null;
  paragraphEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
};

type GeneratedMemoryObject = {
  chunkIndex: number;
  kind: string;
  title: string;
  body: string;
  summary?: string | null;
  tags?: string[];
  aliases?: string[];
};

const MAX_TITLE_LENGTH = 180;
const MAX_BODY_LENGTH = 1600;
const MAX_SUMMARY_LENGTH = 360;

function normalizeWhitespace(value: string) {
  return value
    .replace(/<!--\s*image\s*-->/gi, " ")
    .replace(/<img[^>]*>/gi, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value: string, limit: number) {
  const normalized = normalizeWhitespace(value);
  return normalized.length > limit ? `${normalized.slice(0, limit - 3).trimEnd()}...` : normalized;
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => (value ?? "").trim()).filter(Boolean))
  );
}

function sanitizeKind(kind: string) {
  const normalized = kind
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "memory";
}

function makeCard(
  chunk: ChunkInput,
  params: {
    kind: string;
    title: string;
    body: string;
    summary?: string | null;
    tags?: string[];
    aliases?: string[];
  }
): IndexCardInput {
  return {
    chunkId: chunk.id,
    kind: sanitizeKind(params.kind),
    title: truncate(params.title, MAX_TITLE_LENGTH),
    body: truncate(params.body, MAX_BODY_LENGTH),
    summary: truncate(params.summary ?? params.body, MAX_SUMMARY_LENGTH),
    tags: unique([params.kind, ...(params.tags ?? [])]),
    aliases: unique([chunk.documentTitle, ...(params.aliases ?? [])]),
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    paragraphStart: chunk.paragraphStart,
    paragraphEnd: chunk.paragraphEnd,
    lineStart: chunk.lineStart,
    lineEnd: chunk.lineEnd
  };
}

function looksSubstantive(text: string) {
  return normalizeWhitespace(text).replace(/[^a-z0-9]/gi, "").length >= 24;
}

function parseMarkdownTableRows(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .map((line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => normalizeWhitespace(cell))
    )
    .filter(
      (cells) =>
        cells.length >= 2 && !cells.every((cell) => !cell || /^:?-{2,}:?$/.test(cell))
    );
}

function extractTitleCasePhrases(text: string) {
  const matches =
    normalizeWhitespace(text).match(
      /\b[A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'&.-]+){1,5}\b/g
    ) ?? [];

  return unique(matches).slice(0, 8);
}

function extractFirstMeaningfulSentence(text: string) {
  return (
    normalizeWhitespace(text)
      .split(/(?<=[.!?])\s+/)
      .find((sentence) => sentence.length >= 24) ?? normalizeWhitespace(text)
  );
}

function buildDocumentOverviewCard(chunks: ChunkInput[]) {
  const firstChunk = chunks[0];

  if (!firstChunk) {
    return null;
  }

  const preview = chunks
    .slice(0, 4)
    .map((chunk) => extractFirstMeaningfulSentence(chunk.text))
    .filter(Boolean)
    .join(" ");

  return makeCard(firstChunk, {
    kind: "document_overview",
    title: firstChunk.documentTitle,
    body: preview || firstChunk.text,
    summary: preview || firstChunk.text,
    tags: ["document", "overview"],
    aliases: [firstChunk.documentTitle]
  });
}

function buildHeuristicChunkCards(chunk: ChunkInput) {
  const cards: IndexCardInput[] = [];
  const normalized = normalizeWhitespace(chunk.text);

  if (!looksSubstantive(normalized)) {
    return cards;
  }

  const firstSentence = extractFirstMeaningfulSentence(normalized);
  const names = extractTitleCasePhrases(chunk.text);
  const rows = parseMarkdownTableRows(chunk.text);

  if (/\b(shall|must|required to|is responsible for|are responsible for)\b/i.test(normalized)) {
    cards.push(
      makeCard(chunk, {
        kind: "obligation",
        title: firstSentence.slice(0, 90),
        body: normalized,
        summary: firstSentence,
        tags: ["obligation", "requirement", "control"],
        aliases: names
      })
    );
  }

  if (/\b(prohibited|not permitted|not allowed|unauthorized|must not|shall not|forbidden)\b/i.test(normalized)) {
    cards.push(
      makeCard(chunk, {
        kind: "prohibition",
        title: firstSentence.slice(0, 90),
        body: normalized,
        summary: firstSentence,
        tags: ["prohibition", "policy", "control"],
        aliases: names
      })
    );
  }

  if (/\b(exception|except|unless|approved by|approval from|prior approval)\b/i.test(normalized)) {
    cards.push(
      makeCard(chunk, {
        kind: "exception",
        title: firstSentence.slice(0, 90),
        body: normalized,
        summary: firstSentence,
        tags: ["exception", "approval", "policy"],
        aliases: names
      })
    );
  }

  const definitionMatch = normalized.match(/^(.{3,90}?)\s+(means|refers to|is defined as)\s+(.{20,})$/i);

  if (definitionMatch) {
    cards.push(
      makeCard(chunk, {
        kind: "definition",
        title: definitionMatch[1],
        body: normalized,
        summary: `${definitionMatch[1]} ${definitionMatch[2]} ${truncate(definitionMatch[3], 200)}`,
        tags: ["definition"],
        aliases: [definitionMatch[1]]
      })
    );
  }

  if (rows.length > 0) {
    for (const row of rows.slice(0, 4)) {
      const rowText = row.join(" | ");

      if (!looksSubstantive(rowText)) {
        continue;
      }

      cards.push(
        makeCard(chunk, {
          kind: "table_row",
          title: row[0] || firstSentence.slice(0, 90),
          body: rowText,
          summary: rowText,
          tags: ["table", "row"],
          aliases: row
        })
      );
    }
  }

  if (names.length > 0) {
    cards.push(
      makeCard(chunk, {
        kind: "entity",
        title: names[0],
        body: normalized,
        summary: firstSentence,
        tags: ["entity"],
        aliases: names
      })
    );
  }

  if (cards.length === 0) {
    cards.push(
      makeCard(chunk, {
        kind: "observation",
        title: firstSentence.slice(0, 90),
        body: normalized,
        summary: firstSentence,
        tags: ["observation"],
        aliases: names
      })
    );
  }

  return cards;
}

export function buildFallbackDocumentIndexCards(params: {
  documentTitle: string;
  chunks: ChunkInput[];
}) {
  const cards: IndexCardInput[] = [];
  const overview = buildDocumentOverviewCard(params.chunks);

  if (overview) {
    cards.push(overview);
  }

  for (const chunk of params.chunks) {
    cards.push(...buildHeuristicChunkCards(chunk));
  }

  return dedupeCards(cards);
}

export function materializeGeneratedIndexCards(params: {
  documentTitle: string;
  chunks: ChunkInput[];
  generatedObjects: GeneratedMemoryObject[];
}) {
  const cards: IndexCardInput[] = [];
  const chunksByIndex = new Map(params.chunks.map((chunk) => [chunk.chunkIndex, chunk] as const));
  const overview = buildDocumentOverviewCard(params.chunks);

  if (overview) {
    cards.push(overview);
  }

  for (const object of params.generatedObjects) {
    const chunk = chunksByIndex.get(object.chunkIndex);

    if (!chunk || !looksSubstantive(object.body || object.summary || object.title)) {
      continue;
    }

    cards.push(
      makeCard(chunk, {
        kind: object.kind,
        title: object.title,
        body: object.body,
        summary: object.summary,
        tags: object.tags ?? [],
        aliases: object.aliases ?? []
      })
    );
  }

  if (cards.length <= (overview ? 1 : 0)) {
    return buildFallbackDocumentIndexCards(params);
  }

  return dedupeCards(cards);
}

function dedupeCards(cards: IndexCardInput[]) {
  const seen = new Set<string>();

  return cards.filter((card) => {
    const key = [
      card.chunkId,
      card.kind,
      card.title.toLowerCase(),
      card.summary.toLowerCase()
    ].join("::");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function buildIndexCardSearchText(card: {
  title: string;
  body: string;
  summary: string | null;
  tags: string[];
  aliases: string[];
}) {
  return normalizeWhitespace(
    [card.title, card.summary, card.body, ...card.tags, ...card.aliases].filter(Boolean).join(" ")
  ).toLowerCase();
}
