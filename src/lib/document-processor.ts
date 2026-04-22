import { readFile } from "fs/promises";
import { fileURLToPath } from "url";

export type DoclingExtractionResult = {
  title: string;
  markdown: string;
  pageCount: number | null;
  qualityNotes: string;
};

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
  const formData = new FormData();

  formData.set(
    "file",
    new File([new Uint8Array(bytes)], filename, {
      type: params.mimeType || "application/octet-stream"
    })
  );
  formData.set("title", params.title);
  formData.set("ocrMode", "text-first");

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

    const parsed = JSON.parse(bodyText) as Partial<DoclingExtractionResult>;

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
  } finally {
    clearTimeout(timeoutId);
  }
}
