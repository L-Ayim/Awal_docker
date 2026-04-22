import { basename, extname } from "path";

export type ParsedSection = {
  sectionPath: string;
  heading: string | null;
  ordinal: number;
  body: string;
};

export type ParsedDocument = {
  parser: string;
  title: string;
  sections: ParsedSection[];
  qualityNotes: string;
};

function normalizeNewlines(text: string) {
  return text.replace(/\r\n/g, "\n").trim();
}

function splitParagraphs(text: string) {
  return normalizeNewlines(text)
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function makeSectionPath(index: number) {
  return `${index}`;
}

function parsePlainText(title: string, text: string): ParsedDocument {
  const paragraphs = splitParagraphs(text);
  const sections = (paragraphs.length > 0 ? paragraphs : [normalizeNewlines(text)])
    .filter(Boolean)
    .map((body, index) => ({
      sectionPath: makeSectionPath(index),
      heading: index === 0 ? title : null,
      ordinal: index,
      body
    }));

  return {
    parser: "plain-text",
    title,
    sections,
    qualityNotes: `Parsed ${sections.length} text sections from plain text content.`
  };
}

function parseMarkdown(title: string, text: string): ParsedDocument {
  const normalized = normalizeNewlines(text);
  const lines = normalized.split("\n");
  const sections: ParsedSection[] = [];

  let currentHeading: string | null = title;
  let currentBody: string[] = [];
  let ordinal = 0;

  const flush = () => {
    const body = currentBody.join("\n").trim();
    if (!body) {
      return;
    }

    sections.push({
      sectionPath: makeSectionPath(ordinal),
      heading: currentHeading,
      ordinal,
      body
    });

    ordinal += 1;
    currentBody = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);

    if (headingMatch) {
      flush();
      currentHeading = headingMatch[2].trim() || title;
      continue;
    }

    currentBody.push(line);
  }

  flush();

  if (sections.length === 0) {
    return parsePlainText(title, normalized);
  }

  return {
    parser: "markdown",
    title,
    sections,
    qualityNotes: `Parsed ${sections.length} markdown sections from heading structure.`
  };
}

function parseJson(title: string, text: string): ParsedDocument {
  const value = JSON.parse(text) as unknown;
  const pretty = JSON.stringify(value, null, 2);
  return {
    parser: "json",
    title,
    sections: [
      {
        sectionPath: "0",
        heading: title,
        ordinal: 0,
        body: pretty
      }
    ],
    qualityNotes: "Parsed JSON into a normalized pretty-printed section."
  };
}

function parseCsv(title: string, text: string): ParsedDocument {
  const lines = normalizeNewlines(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new Error("CSV file is empty.");
  }

  const header = lines[0];
  const rows = lines.slice(1);
  const sectionBodies: string[] = [];
  const batchSize = 25;

  for (let start = 0; start < rows.length || (rows.length === 0 && start === 0); start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const body = [header, ...batch].join("\n");
    sectionBodies.push(body);
    if (rows.length === 0) {
      break;
    }
  }

  return {
    parser: "csv",
    title,
    sections: sectionBodies.map((body, index) => ({
      sectionPath: makeSectionPath(index),
      heading: index === 0 ? `${title} (table)` : `${title} (rows ${index * batchSize + 1}+)`,
      ordinal: index,
      body
    })),
    qualityNotes: `Parsed CSV into ${sectionBodies.length} table section(s).`
  };
}

export function detectParser(params: {
  sourceKind: string;
  mimeType: string;
  storageUri: string | null;
  title: string;
}) {
  const extension = extname(params.storageUri ? basename(params.storageUri) : params.title).toLowerCase();
  const mimeType = params.mimeType.toLowerCase();

  if (mimeType.includes("markdown") || extension === ".md" || extension === ".markdown") {
    return "markdown" as const;
  }

  if (mimeType.includes("json") || extension === ".json") {
    return "json" as const;
  }

  if (mimeType.includes("csv") || extension === ".csv") {
    return "csv" as const;
  }

  return "plain-text" as const;
}

export function parseDocumentText(params: {
  parser: ReturnType<typeof detectParser>;
  title: string;
  text: string;
}) {
  switch (params.parser) {
    case "markdown":
      return parseMarkdown(params.title, params.text);
    case "json":
      return parseJson(params.title, params.text);
    case "csv":
      return parseCsv(params.title, params.text);
    case "plain-text":
    default:
      return parsePlainText(params.title, params.text);
  }
}
