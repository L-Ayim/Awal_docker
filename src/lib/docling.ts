import { access } from "fs/promises";
import { constants as fsConstants } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { materializeStoredFile } from "@/lib/storage";

const execFileAsync = promisify(execFile);

export type DoclingExtractionResult = {
  title: string;
  markdown: string;
  pageCount: number | null;
  qualityNotes: string;
};

function candidatePythonPaths() {
  const cwd = process.cwd();
  return [
    process.env.DOCLING_PYTHON,
    join(cwd, ".venv-docling", "Scripts", "python.exe"),
    join(cwd, ".venv-docling", "bin", "python")
  ].filter((value): value is string => Boolean(value && value.trim()));
}

export async function resolveDoclingPython() {
  for (const candidate of candidatePythonPaths()) {
    try {
      await access(candidate, fsConstants.F_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return "python";
}

export async function getDoclingRuntimeStatus() {
  for (const candidate of candidatePythonPaths()) {
    try {
      await access(candidate, fsConstants.F_OK);
      return {
        configured: true,
        python: candidate
      };
    } catch {
      continue;
    }
  }

  return {
    configured: false,
    python: null
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

export async function extractWithDocling(params: {
  storageUri: string | null;
  title: string;
}) {
  const python = await resolveDoclingPython();
  const scriptPath = join(process.cwd(), "scripts", "docling_extract.py");
  const timeout = Number.parseInt(process.env.DOCLING_TIMEOUT_MS || "120000", 10);
  const materialized = await materializeStoredFile({
    storageUri: params.storageUri,
    filenameHint: params.title
  });

  try {
    const { stdout, stderr } = await execFileAsync(
      python,
      [scriptPath, "--source", materialized.absolutePath, "--title", params.title],
      {
        timeout: Number.isFinite(timeout) ? timeout : 120000,
        maxBuffer: 10 * 1024 * 1024
      }
    );

    if (!stdout.trim()) {
      throw new Error(stderr.trim() || "Docling returned an empty response.");
    }

    const parsed = JSON.parse(stdout) as Partial<DoclingExtractionResult>;

    if (!parsed.markdown || typeof parsed.markdown !== "string") {
      throw new Error("Docling did not return Markdown output.");
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
          : "Converted with Docling."
    };
  } finally {
    await materialized.cleanup();
  }
}
