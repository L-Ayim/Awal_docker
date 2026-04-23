import { readStoredBytes } from "@/lib/storage";

type PdfLine = {
  pageNumber: number;
  lineNumber: number;
  paragraphNumber: number;
  text: string;
  y: number;
};

type PdfLineMatch = {
  pageStart: number;
  pageEnd: number;
  paragraphStart: number;
  paragraphEnd: number;
  lineStart: number;
  lineEnd: number;
  quotedText: string;
};

type PdfTextItem = {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
};

function normalizeText(value: string) {
  return value
    .replace(/[#*_`>\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenize(value: string) {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function diceCoefficient(left: string, right: string) {
  if (!left || !right) {
    return 0;
  }

  const buildBigrams = (value: string) => {
    const output = new Map<string, number>();

    for (let index = 0; index < value.length - 1; index += 1) {
      const key = value.slice(index, index + 2);
      output.set(key, (output.get(key) ?? 0) + 1);
    }

    return output;
  };

  const leftBigrams = buildBigrams(left);
  const rightBigrams = buildBigrams(right);
  let overlap = 0;

  for (const [key, count] of leftBigrams.entries()) {
    overlap += Math.min(count, rightBigrams.get(key) ?? 0);
  }

  const leftSize = Math.max(left.length - 1, 1);
  const rightSize = Math.max(right.length - 1, 1);

  return (2 * overlap) / (leftSize + rightSize);
}

function buildQuotedText(lines: PdfLine[]) {
  const text = lines.map((line) => line.text.trim()).filter(Boolean).join(" ");
  return text.length > 280 ? `${text.slice(0, 277).trimEnd()}...` : text;
}

async function loadPdfDocument(storageUri: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const stored = await readStoredBytes(storageUri);

  return pdfjs.getDocument({
    data: new Uint8Array(stored.bytes)
  }).promise;
}

function joinLineText(parts: Array<{ x: number; text: string }>) {
  const ordered = [...parts].sort((left, right) => left.x - right.x);
  let result = "";

  for (const part of ordered) {
    const text = part.text.trim();
    if (!text) {
      continue;
    }

    if (!result) {
      result = text;
      continue;
    }

    if (/^[,.;:!?)}\]]/.test(text)) {
      result += text;
      continue;
    }

    if (result.endsWith("-")) {
      result = `${result.slice(0, -1)}${text}`;
      continue;
    }

    result += ` ${text}`;
  }

  return result.trim();
}

async function extractPageLines(storageUri: string): Promise<PdfLine[]> {
  const document = await loadPdfDocument(storageUri);
  const lines: PdfLine[] = [];

  for (let pageIndex = 1; pageIndex <= document.numPages; pageIndex += 1) {
    const page = await document.getPage(pageIndex);
    const textContent = await page.getTextContent();
    const items = (textContent.items as PdfTextItem[])
      .map((item) => ({
        text: item.str?.trim() || "",
        x: item.transform?.[4] ?? 0,
        y: item.transform?.[5] ?? 0
      }))
      .filter((item) => item.text.length > 0)
      .sort((left, right) => {
        if (Math.abs(left.y - right.y) > 2) {
          return right.y - left.y;
        }

        return left.x - right.x;
      });

    const grouped: Array<{
      y: number;
      parts: Array<{ x: number; text: string }>;
    }> = [];

    for (const item of items) {
      const current = grouped[grouped.length - 1];

      if (!current || Math.abs(current.y - item.y) > 3) {
        grouped.push({
          y: item.y,
          parts: [{ x: item.x, text: item.text }]
        });
        continue;
      }

      current.parts.push({ x: item.x, text: item.text });
    }

    const verticalGaps = grouped
      .slice(1)
      .map((group, index) => Math.abs(grouped[index].y - group.y))
      .filter((gap) => gap > 0.5)
      .sort((left, right) => left - right);
    const medianGap =
      verticalGaps.length > 0
        ? verticalGaps[Math.floor(verticalGaps.length / 2)]
        : 14;
    let paragraphNumber = 1;

    grouped.forEach((group, index) => {
      const text = joinLineText(group.parts);

      if (!text) {
        return;
      }

      if (index > 0) {
        const gap = Math.abs(grouped[index - 1].y - group.y);
        if (gap > medianGap * 1.6) {
          paragraphNumber += 1;
        }
      }

      lines.push({
        pageNumber: pageIndex,
        lineNumber: lines.filter((line) => line.pageNumber === pageIndex).length + 1,
        paragraphNumber,
        text,
        y: group.y
      });
    });
  }

  return lines;
}

export async function buildPdfCitationIndex(storageUri: string | null) {
  if (!storageUri) {
    return null;
  }

  try {
    const lines = await extractPageLines(storageUri);
    return {
      lines
    };
  } catch {
    return null;
  }
}

export function locateChunkInPdf(
  chunkText: string,
  citationIndex: Awaited<ReturnType<typeof buildPdfCitationIndex>>
): PdfLineMatch | null {
  if (!citationIndex || citationIndex.lines.length === 0) {
    return null;
  }

  const normalizedChunk = normalizeText(chunkText);
  const chunkTokens = tokenize(chunkText);

  if (!normalizedChunk || chunkTokens.length === 0) {
    return null;
  }

  let best:
    | {
        score: number;
        lines: PdfLine[];
      }
    | null = null;

  for (let start = 0; start < citationIndex.lines.length; start += 1) {
    const windowLines: PdfLine[] = [];

    for (
      let end = start;
      end < citationIndex.lines.length && end < start + 14;
      end += 1
    ) {
      windowLines.push(citationIndex.lines[end]);

      const windowText = windowLines.map((line) => line.text).join(" ");
      const normalizedWindow = normalizeText(windowText);
      const windowTokens = new Set(tokenize(windowText));
      let overlap = 0;

      for (const token of chunkTokens) {
        if (windowTokens.has(token)) {
          overlap += 1;
        }
      }

      const recall = overlap / chunkTokens.length;
      const dice = diceCoefficient(
        normalizedChunk.slice(0, 500),
        normalizedWindow.slice(0, 500)
      );
      const lengthPenalty =
        Math.abs(normalizedWindow.length - normalizedChunk.length) /
        Math.max(normalizedChunk.length, 1);
      const score = recall * 0.6 + dice * 0.5 - Math.min(lengthPenalty, 1) * 0.15;

      if (!best || score > best.score) {
        best = {
          score,
          lines: [...windowLines]
        };
      }
    }
  }

  if (!best || best.score < 0.25) {
    return null;
  }

  const firstLine = best.lines[0];
  const lastLine = best.lines[best.lines.length - 1];

  return {
    pageStart: firstLine.pageNumber,
    pageEnd: lastLine.pageNumber,
    paragraphStart: firstLine.paragraphNumber,
    paragraphEnd: lastLine.paragraphNumber,
    lineStart: firstLine.lineNumber,
    lineEnd: lastLine.lineNumber,
    quotedText: buildQuotedText(best.lines)
  };
}
