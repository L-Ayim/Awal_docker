import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type DoclingExtractionResult = {
  title: string;
  markdown: string;
  pageCount: number | null;
  qualityNotes: string;
};

function isWeakMarkdown(markdown: string) {
  const normalized = markdown.trim();

  if (!normalized) {
    return true;
  }

  const imageMarkerMatches = normalized.match(/<!--\s*image\s*-->/gi) ?? [];
  const textWithoutImageMarkers = normalized
    .replace(/<!--\s*image\s*-->/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const alphaNumericChars = (textWithoutImageMarkers.match(/[A-Za-z0-9]/g) ?? []).length;
  const imageHeavy =
    imageMarkerMatches.length >= 3 &&
    alphaNumericChars < Math.max(400, imageMarkerMatches.length * 40);

  return imageHeavy || alphaNumericChars < 200;
}

function getRemoteProcessorConfig() {
  const baseUrl = process.env.DOC_PROCESSOR_BASE_URL?.trim() || "";
  const apiKey = process.env.DOC_PROCESSOR_API_KEY?.trim() || "";
  const timeoutMs = Number.parseInt(process.env.DOC_PROCESSOR_TIMEOUT_MS || "600000", 10);

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 600000,
    configured: baseUrl.length > 0
  };
}

export function shouldUseDocling(params: {
  mimeType: string;
  storageUri: string | null;
}) {
  const mimeType = params.mimeType.toLowerCase();
  const storageUri = (params.storageUri || "").toLowerCase();

  const plainTextLike =
    mimeType.startsWith("text/plain") ||
    mimeType.includes("markdown") ||
    mimeType.includes("json") ||
    mimeType.includes("csv") ||
    storageUri.endsWith(".txt") ||
    storageUri.endsWith(".md") ||
    storageUri.endsWith(".markdown") ||
    storageUri.endsWith(".json") ||
    storageUri.endsWith(".csv");

  return !plainTextLike;
}

export function getDocumentProcessorRuntimeStatus() {
  const config = getRemoteProcessorConfig();

  return {
    mode: config.configured ? "remote" : "disabled",
    configured: config.configured,
    baseUrl: config.configured ? config.baseUrl : null
  };
}

async function loadStoredFile(storageUri: string | null) {
  if (!storageUri || !storageUri.startsWith("file://")) {
    throw new Error("Document processor currently requires a file:// storage URI.");
  }

  const absolutePath = fileURLToPath(storageUri);
  const bytes = await readFile(absolutePath);

  return {
    absolutePath,
    bytes
  };
}

async function extractWithRemoteDoclingViaCurl(params: {
  absolutePath: string;
  title: string;
  mimeType: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  ocrMode: string;
}) {
  const args = [
    "--silent",
    "--show-error",
    "--max-time",
    String(Math.max(30, Math.ceil(params.timeoutMs / 1000))),
    "-X",
    "POST",
    `${params.baseUrl}/extract`,
    "-H",
    `Authorization: Bearer ${params.apiKey}`,
    "-F",
    `file=@${params.absolutePath};type=${params.mimeType || "application/octet-stream"}`,
    "-F",
    `title=${params.title}`,
    "-F",
    `ocrMode=${params.ocrMode}`
  ];

  const { stdout, stderr } = await execFileAsync("curl.exe", args, {
    maxBuffer: 20 * 1024 * 1024
  });

  if (!stdout.trim()) {
    throw new Error(stderr.trim() || "Remote document processor returned an empty response.");
  }

  return stdout;
}

export async function extractWithRemoteDocling(params: {
  storageUri: string | null;
  title: string;
  mimeType: string;
}) {
  const config = getRemoteProcessorConfig();

  if (!config.configured) {
    throw new Error("Remote document processor is not configured.");
  }

  const { absolutePath, bytes } = await loadStoredFile(params.storageUri);
  const filename = absolutePath.split(/[\\/]/).pop() || `${params.title}.bin`;

  async function requestExtraction(ocrMode: string) {
    if (process.platform === "win32" && config.apiKey) {
      return extractWithRemoteDoclingViaCurl({
        absolutePath,
        title: params.title,
        mimeType: params.mimeType,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        timeoutMs: config.timeoutMs,
        ocrMode
      });
    }

    const formData = new FormData();
    formData.set(
      "file",
      new File([new Uint8Array(bytes)], filename, {
        type: params.mimeType || "application/octet-stream"
      })
    );
    formData.set("title", params.title);
    formData.set("ocrMode", ocrMode);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(`${config.baseUrl}/extract`, {
        method: "POST",
        headers: config.apiKey
          ? {
              Authorization: `Bearer ${config.apiKey}`
            }
          : undefined,
        body: formData,
        signal: controller.signal
      });

      const bodyText = await response.text();

      if (!response.ok) {
        throw new Error(bodyText || `Document processor failed with status ${response.status}.`);
      }

      return bodyText;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  const firstPassText = await requestExtraction("text-first");
  let parsed = JSON.parse(firstPassText) as Partial<DoclingExtractionResult>;

  if (typeof parsed.markdown === "string" && isWeakMarkdown(parsed.markdown)) {
    const ocrPassText = await requestExtraction("force-ocr");
    const ocrParsed = JSON.parse(ocrPassText) as Partial<DoclingExtractionResult>;

    if (typeof ocrParsed.markdown === "string" && !isWeakMarkdown(ocrParsed.markdown)) {
      parsed = {
        ...ocrParsed,
        qualityNotes:
          typeof ocrParsed.qualityNotes === "string" && ocrParsed.qualityNotes.length > 0
            ? `${ocrParsed.qualityNotes} Retried with OCR after weak text-first extraction.`
            : "Converted with remote Docling (force-ocr). Retried after weak text-first extraction."
      };
    }
  }

  if (!parsed.markdown || typeof parsed.markdown !== "string") {
    throw new Error("Remote document processor did not return Markdown output.");
  }

  return {
    title: parsed.title || params.title,
    markdown: parsed.markdown,
    pageCount:
      typeof parsed.pageCount === "number" && Number.isFinite(parsed.pageCount)
        ? parsed.pageCount
        : null,
    qualityNotes:
      typeof parsed.qualityNotes === "string" && parsed.qualityNotes.length > 0
        ? parsed.qualityNotes
        : "Converted with remote Docling."
  };
}
