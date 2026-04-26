"use client";

import { type DragEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  FileArchive,
  FileText,
  FolderUp,
  Library,
  MessageSquare,
  Play,
  RefreshCw,
  RotateCw,
  Square,
  Trash2,
  Upload
} from "lucide-react";

type BootstrapResponse = {
  workspace: {
    id: string;
    name?: string;
  };
  collection: {
    id: string;
    name?: string;
  };
};

type DocumentRow = {
  id: string;
  title: string;
  sourceKind: string;
  mimeType: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  latestRevision: {
    id: string;
    status: string;
    extractionQuality: string | null;
    reviewFlag: boolean;
    qualityNotes: string | null;
    fileSizeBytes: string | null;
    chunkCount: number;
    indexCardCount: number;
    updatedAt: string;
  } | null;
  latestJob: {
    id: string;
    status: string;
    attemptCount: number;
    lastError: string | null;
    queuedAt: string;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
};

type DocumentDetail = {
  document: {
    id: string;
    title: string;
    sourceKind: string;
    mimeType: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    latestRevision: {
      id: string;
      checksum: string | null;
      storageUri: string | null;
      fileSizeBytes: string | null;
      status: string;
      extractionQuality: string | null;
      ingestionMode: string;
      reviewFlag: boolean;
      qualityNotes: string | null;
      createdAt: string;
      updatedAt: string;
      jobs: Array<{
        id: string;
        status: string;
        attemptCount: number;
        workerHint: string | null;
        queuedAt: string;
        startedAt: string | null;
        completedAt: string | null;
        lastError: string | null;
      }>;
      sections: Array<{
        id: string;
        sectionPath: string;
        heading: string | null;
        ordinal: number;
      }>;
      chunks: Array<{
        id: string;
        chunkIndex: number;
        text: string;
        tokenCount: number | null;
        charCount: number;
        pageStart: number | null;
        pageEnd: number | null;
        paragraphStart: number | null;
        paragraphEnd: number | null;
        lineStart: number | null;
        lineEnd: number | null;
        citationQuotedText: string | null;
        embedding: {
          modelName: string;
          dimensions: number;
        } | null;
      }>;
      indexCards: Array<{
        id: string;
        kind: string;
        title: string;
        body: string;
        summary: string | null;
        tags: string[];
        aliases: string[];
        pageStart: number | null;
        pageEnd: number | null;
        paragraphStart: number | null;
        paragraphEnd: number | null;
        lineStart: number | null;
        lineEnd: number | null;
        chunk: {
          id: string;
          chunkIndex: number;
        } | null;
        embedding: {
          modelName: string;
          dimensions: number;
        } | null;
      }>;
    } | null;
  };
};

type DocumentsResponse = {
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  summary: {
    total: number;
    ready: number;
    working: number;
    failed: number;
  };
  documents: DocumentRow[];
};

type RunQueueResponse = {
  processed: boolean;
  processedCount: number;
  reason: string | null;
};

type RuntimeStatus = "asleep" | "waking" | "ready" | "stopping" | "failed";

type RuntimeSnapshot = {
  automationEnabled: boolean;
  status: RuntimeStatus;
  podId: string | null;
  podName: string | null;
  lastRequestAt: string | null;
  lastHealthAt: string | null;
  idleMinutes: number;
  lastError: string | null;
};

type UploadableFile = File & {
  webkitRelativePath?: string;
};

type UploadCandidate = {
  file: File;
  title: string;
};

type UploadProgress = {
  filename: string;
  current: number;
  total: number;
  loaded: number;
  bytesTotal: number | null;
  percent: number | null;
};

type FileSystemEntryLike = {
  name: string;
  fullPath?: string;
  isFile: boolean;
  isDirectory: boolean;
};

type FileSystemFileEntryLike = FileSystemEntryLike & {
  file: (successCallback: (file: File) => void, errorCallback?: (error: DOMException) => void) => void;
};

type FileSystemDirectoryReaderLike = {
  readEntries: (
    successCallback: (entries: FileSystemEntryLike[]) => void,
    errorCallback?: (error: DOMException) => void
  ) => void;
};

type FileSystemDirectoryEntryLike = FileSystemEntryLike & {
  createReader: () => FileSystemDirectoryReaderLike;
};

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(json?.message || json?.error || `Request failed with status ${response.status}.`);
  }

  return json as T;
}

function parseUploadResponse<T>(xhr: XMLHttpRequest): T {
  const json = xhr.responseText ? JSON.parse(xhr.responseText) : null;

  if (xhr.status < 200 || xhr.status >= 300) {
    throw new Error(json?.message || json?.error || `Request failed with status ${xhr.status}.`);
  }

  return json as T;
}

function uploadWithProgress<T>({
  url,
  formData,
  onProgress
}: {
  url: string;
  formData: FormData;
  onProgress: (event: ProgressEvent<EventTarget>) => void;
}) {
  return new Promise<{ status: number; payload: T | null }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("POST", url);
    xhr.upload.onprogress = onProgress;
    xhr.onerror = () => reject(new Error("Upload failed before the server received the file."));
    xhr.onabort = () => reject(new Error("Upload was cancelled."));
    xhr.onload = () => {
      try {
        if (xhr.status === 409) {
          resolve({ status: xhr.status, payload: null });
          return;
        }

        resolve({ status: xhr.status, payload: parseUploadResponse<T>(xhr) });
      } catch (error) {
        reject(error);
      }
    };
    xhr.send(formData);
  });
}

function formatBytes(value: string | null) {
  if (!value) {
    return "Unknown";
  }

  const bytes = Number(value);

  if (!Number.isFinite(bytes)) {
    return "Unknown";
  }

  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(document: DocumentRow) {
  return document.latestJob?.status || document.latestRevision?.status || document.status;
}

function formatDate(value: string | null) {
  if (!value) {
    return "n/a";
  }

  return new Date(value).toLocaleString();
}

function getRuntimeLabel(status: RuntimeStatus) {
  switch (status) {
    case "ready":
      return "Ingest ready";
    case "waking":
      return "Ingest starting";
    case "stopping":
      return "Ingest stopping";
    case "failed":
      return "Ingest failed";
    case "asleep":
    default:
      return "Ingest asleep";
  }
}

function formatRemaining(ms: number) {
  if (ms <= 0) {
    return "due now";
  }

  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

const ingestionSteps = [
  { status: "uploaded", label: "Queued" },
  { status: "parsing_standard", label: "Docling" },
  { status: "parsed_standard", label: "Chunking" },
  { status: "embedding", label: "Embeddings" },
  { status: "normalizing", label: "LLM understanding" },
  { status: "ready", label: "Ready" }
];

function documentProgress(document: DocumentRow) {
  const revisionStatus = document.latestRevision?.status || document.status;
  const jobStatus = document.latestJob?.status || "";

  if (document.status === "failed" || revisionStatus === "failed" || jobStatus === "failed") {
    return {
      visible: true,
      label: "Failed",
      detail: document.latestJob?.lastError || document.latestRevision?.qualityNotes || "Ingestion failed.",
      percent: 100,
      activeIndex: -1
    };
  }

  if (document.status === "ready" || revisionStatus === "ready" || jobStatus === "completed") {
    return {
      visible: false,
      label: "Ready",
      detail: "Ready",
      percent: 100,
      activeIndex: ingestionSteps.length - 1
    };
  }

  const activeIndex = Math.max(
    0,
    ingestionSteps.findIndex((step) => step.status === revisionStatus)
  );
  const label =
    jobStatus === "queued"
      ? "Queued"
      : ingestionSteps[activeIndex]?.label || revisionStatus.replace(/_/g, " ");
  const detail =
    revisionStatus === "parsing_standard"
      ? "Extracting document structure with Docling."
      : revisionStatus === "embedding"
        ? `Embedding ${document.latestRevision?.chunkCount ?? 0} chunk(s).`
        : revisionStatus === "normalizing"
          ? "Generating semantic memory cards with the LLM."
          : jobStatus === "queued"
            ? "Waiting for the ingest worker."
            : "Preparing document memory.";

  return {
    visible: true,
    label,
    detail,
    percent: Math.round((activeIndex / Math.max(1, ingestionSteps.length - 1)) * 100),
    activeIndex
  };
}

function fileTitle(file: UploadableFile) {
  return file.webkitRelativePath?.trim() || file.name;
}

function fileToUploadCandidate(file: UploadableFile): UploadCandidate {
  return {
    file,
    title: fileTitle(file)
  };
}

function readDirectoryEntries(reader: FileSystemDirectoryReaderLike): Promise<FileSystemEntryLike[]> {
  return new Promise((resolve, reject) => {
    const entries: FileSystemEntryLike[] = [];

    function readNextBatch() {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(entries);
            return;
          }

          entries.push(...batch);
          readNextBatch();
        },
        (error) => reject(error)
      );
    }

    readNextBatch();
  });
}

function readFileEntry(entry: FileSystemFileEntryLike): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

async function collectEntryFiles(
  entry: FileSystemEntryLike,
  parentPath = ""
): Promise<UploadCandidate[]> {
  const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;

  if (entry.isFile) {
    const file = await readFileEntry(entry as FileSystemFileEntryLike);

    return [
      {
        file,
        title: path
      }
    ];
  }

  if (!entry.isDirectory) {
    return [];
  }

  const reader = (entry as FileSystemDirectoryEntryLike).createReader();
  const children = await readDirectoryEntries(reader);
  const nested = await Promise.all(children.map((child) => collectEntryFiles(child, path)));

  return nested.flat();
}

async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<UploadCandidate[]> {
  const itemEntries: FileSystemEntryLike[] = [];

  for (const item of Array.from(dataTransfer.items)) {
    const entry = (item as DataTransferItem & {
      webkitGetAsEntry?: () => FileSystemEntryLike | null;
    }).webkitGetAsEntry?.() ?? null;

    if (entry) {
      itemEntries.push(entry);
    }
  }

  if (itemEntries.length > 0) {
    const nested = await Promise.all(itemEntries.map((entry) => collectEntryFiles(entry)));
    return nested.flat();
  }

  return Array.from(dataTransfer.files).map((file) => fileToUploadCandidate(file as UploadableFile));
}

function IngestRuntimePanel({
  runtime,
  isWaking,
  isStopping,
  onWake,
  onSleep,
  onRefresh
}: {
  runtime: RuntimeSnapshot | null;
  isWaking: boolean;
  isStopping: boolean;
  onWake: () => void;
  onSleep: () => void;
  onRefresh: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const sleepAt =
    runtime?.lastRequestAt && runtime.status === "ready"
      ? new Date(runtime.lastRequestAt).getTime() + runtime.idleMinutes * 60 * 1000
      : null;
  const remainingMs = sleepAt ? sleepAt - now : null;
  const sleepLabel =
    remainingMs !== null && remainingMs <= 0
      ? "Sleep due"
      : remainingMs !== null
        ? `Sleeps in ${formatRemaining(remainingMs)}`
        : null;
  const idleProgress =
    remainingMs !== null && runtime
      ? Math.max(0, Math.min(100, 100 - (remainingMs / (runtime.idleMinutes * 60 * 1000)) * 100))
      : 0;
  const canWake =
    Boolean(runtime?.automationEnabled) &&
    !isWaking &&
    !isStopping &&
    (runtime?.status === "asleep" || runtime?.status === "failed");
  const canSleep =
    Boolean(runtime?.automationEnabled) &&
    !isWaking &&
    !isStopping &&
    (runtime?.status === "ready" || runtime?.status === "waking");
  const title =
    runtime?.automationEnabled === false
      ? "RunPod automation is disabled"
      : runtime?.podId
        ? `${getRuntimeLabel(runtime.status)}: ${runtime.podName || runtime.podId}${
            sleepLabel ? `. ${sleepLabel}.` : ""
          }`
        : runtime?.lastError || getRuntimeLabel(runtime?.status ?? "asleep");

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 30000);

    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <section className="upload-ingest-runtime" aria-label="Ingest pod status">
      <div
        className={`runtime-status-pill ${runtime?.status ?? "unknown"}`}
        title={title}
        aria-label={title}
      >
        <span aria-hidden="true" />
        <div className="runtime-status-copy">
          <strong>{runtime ? getRuntimeLabel(runtime.status) : "Ingest unknown"}</strong>
          <small>
            {remainingMs !== null
              ? sleepLabel
              : runtime?.podId
                ? runtime.podId.slice(0, 6)
                : "No pod"}
          </small>
        </div>
        {remainingMs !== null ? (
          <div className="runtime-idle-timeline" aria-hidden="true">
            <span style={{ width: `${idleProgress}%` }} />
          </div>
        ) : null}
        <button
          type="button"
          className="runtime-wake-button"
          onClick={canSleep ? onSleep : onWake}
          disabled={!canWake && !canSleep}
          aria-label={canSleep ? "Stop ingest pod" : "Start ingest pod"}
          title={canSleep ? "Stop ingest pod" : "Start ingest pod"}
        >
          {canSleep ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}
          <span>{canSleep ? "Stop pod" : "Start pod"}</span>
        </button>
        <button
          type="button"
          className="runtime-wake-button"
          onClick={onRefresh}
          aria-label="Refresh ingest pod status"
          title="Refresh ingest pod status"
        >
          <RefreshCw aria-hidden="true" />
          <span>Check status</span>
        </button>
      </div>
    </section>
  );
}

export function UploadConsole() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [detailsById, setDetailsById] = useState<Record<string, DocumentDetail["document"] | undefined>>({});
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runQueueStatus, setRunQueueStatus] = useState<string | null>(null);
  const [ingestRuntime, setIngestRuntime] = useState<RuntimeSnapshot | null>(null);
  const [isWakingIngestRuntime, setIsWakingIngestRuntime] = useState(false);
  const [isStoppingIngestRuntime, setIsStoppingIngestRuntime] = useState(false);
  const [isDraggingUpload, setIsDraggingUpload] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 25,
    total: 0,
    totalPages: 1
  });
  const [summary, setSummary] = useState({
    total: 0,
    ready: 0,
    working: 0,
    failed: 0
  });
  const [error, setError] = useState<string | null>(null);

  const documentUrl = bootstrap
    ? `/api/v1/workspaces/${bootstrap.workspace.id}/collections/${bootstrap.collection.id}/documents`
    : null;
  const readyCount = summary.ready;
  const workingCount = summary.working;
  const failedCount = summary.failed;

  async function refreshDocuments() {
    if (!documentUrl) {
      return;
    }

    const payload = await parseJson<DocumentsResponse>(
      await fetch(`${documentUrl}?page=${page}&pageSize=${pagination.pageSize}`, {
        cache: "no-store"
      })
    );
    setDocuments(payload.documents);
    setPagination(payload.pagination);
    setSummary(payload.summary);
  }

  async function refreshIngestRuntime() {
    const data = await parseJson<{
      automationEnabled: boolean;
      ingestIdleMinutes: number;
      runtimes: {
        ingest: {
          status: RuntimeStatus;
          podId: string | null;
          podName: string | null;
          lastRequestAt: string | null;
          lastHealthAt: string | null;
          lastError: string | null;
        };
      };
    }>(
      await fetch("/api/v1/gpu-runtime", {
        cache: "no-store"
      })
    );

    setIngestRuntime({
      automationEnabled: data.automationEnabled,
      status: data.runtimes.ingest.status,
      podId: data.runtimes.ingest.podId,
      podName: data.runtimes.ingest.podName,
      lastRequestAt: data.runtimes.ingest.lastRequestAt,
      lastHealthAt: data.runtimes.ingest.lastHealthAt,
      idleMinutes: data.ingestIdleMinutes,
      lastError: data.runtimes.ingest.lastError
    });
  }

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setIsLoading(true);
        const nextBootstrap = await parseJson<BootstrapResponse>(await fetch("/api/v1/bootstrap"));

        if (!alive) return;

        setBootstrap(nextBootstrap);
      } catch (nextError) {
        if (alive) {
          setError(nextError instanceof Error ? nextError.message : "Failed to load upload console.");
        }
      } finally {
        if (alive) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!documentUrl) {
      return;
    }

    void refreshDocuments().catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : "Failed to load documents.");
    });

    const id = window.setInterval(() => {
      void refreshDocuments().catch(() => undefined);
    }, 8000);

    return () => window.clearInterval(id);
  }, [documentUrl, page, pagination.pageSize]);

  useEffect(() => {
    let alive = true;

    async function poll() {
      try {
        await refreshIngestRuntime();
      } catch {
        if (alive) {
          setIngestRuntime(null);
        }
      }
    }

    void poll();
    const hasWorkingDocuments = documents.some((document) =>
      ["queued", "processing", "uploaded"].includes(statusLabel(document))
    );
    const shouldPollFast =
      hasWorkingDocuments ||
      isRunning ||
      isWakingIngestRuntime ||
      isStoppingIngestRuntime ||
      ingestRuntime?.status === "waking" ||
      ingestRuntime?.status === "ready" ||
      ingestRuntime?.status === "stopping";
    const intervalId = window.setInterval(() => void poll(), shouldPollFast ? 5000 : 15000);

    return () => {
      alive = false;
      window.clearInterval(intervalId);
    };
  }, [documents, ingestRuntime?.status, isRunning, isWakingIngestRuntime, isStoppingIngestRuntime]);

  async function ensureDetail(documentId: string) {
    if (detailsById[documentId]) {
      return;
    }

    const payload = await parseJson<DocumentDetail>(await fetch(`/api/v1/documents/${documentId}`));
    setDetailsById((current) => ({
      ...current,
      [documentId]: payload.document
    }));
  }

  async function toggleExpanded(documentId: string) {
    const isExpanded = expandedIds.includes(documentId);

    if (isExpanded) {
      setExpandedIds((current) => current.filter((id) => id !== documentId));
      return;
    }

    await ensureDetail(documentId);
    setExpandedIds((current) => [...current, documentId]);
  }

  async function runNextJob() {
    try {
      setIsRunning(true);
      setError(null);
      setRunQueueStatus("Starting queue");
      let totalProcessed = 0;

      for (let batch = 1; batch <= 40; batch += 1) {
        const result = await parseJson<RunQueueResponse>(
          await fetch("/api/v1/ingestion-jobs/run-next?maxJobs=10", { method: "POST" })
        );

        totalProcessed += result.processedCount;
        setRunQueueStatus(
          result.reason === "no_queued_jobs"
            ? totalProcessed > 0
              ? `Processed ${totalProcessed} document(s)`
              : "No queued documents"
            : `Processed ${totalProcessed} document(s)`
        );
        await refreshDocuments();

        if (!result.processed || result.reason === "no_queued_jobs") {
          break;
        }
      }

      await refreshDocuments();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to run ingestion.");
    } finally {
      setIsRunning(false);
      window.setTimeout(() => setRunQueueStatus(null), 5000);
    }
  }

  async function wakeIngestRuntime() {
    try {
      setIsWakingIngestRuntime(true);
      setError(null);
      const data = await parseJson<{
        runtime: Omit<RuntimeSnapshot, "automationEnabled" | "idleMinutes">;
      }>(
        await fetch("/api/v1/gpu-runtime/wake-ui?kind=ingest", {
          method: "POST"
        })
      );

      setIngestRuntime((current) => ({
        automationEnabled: current?.automationEnabled ?? true,
        idleMinutes: current?.idleMinutes ?? 5,
        ...data.runtime
      }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to start ingest pod.");
    } finally {
      setIsWakingIngestRuntime(false);
    }
  }

  async function sleepIngestRuntime() {
    try {
      setIsStoppingIngestRuntime(true);
      setError(null);
      const data = await parseJson<{
        runtime: Omit<RuntimeSnapshot, "automationEnabled" | "idleMinutes">;
      }>(
        await fetch("/api/v1/gpu-runtime/sleep-ui?kind=ingest", {
          method: "POST"
        })
      );

      setIngestRuntime((current) => ({
        automationEnabled: current?.automationEnabled ?? true,
        idleMinutes: current?.idleMinutes ?? 5,
        ...data.runtime
      }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to stop ingest pod.");
    } finally {
      setIsStoppingIngestRuntime(false);
    }
  }

  async function uploadFiles(files: FileList | File[] | UploadCandidate[]) {
    if (!documentUrl || !files.length) {
      return;
    }

    try {
      setIsUploading(true);
      setError(null);

      const candidates = Array.from(files as ArrayLike<File | UploadCandidate>).map(
        (item): UploadCandidate =>
          item instanceof File ? fileToUploadCandidate(item as UploadableFile) : item
      );
      const skipped: string[] = [];
      const totalBytes = candidates.reduce((sum, candidate) => sum + candidate.file.size, 0);
      let completedBytes = 0;

      for (const [index, candidate] of candidates.entries()) {
        const formData = new FormData();
        formData.set("file", candidate.file);
        formData.set("title", candidate.title);
        formData.set("ingestionMode", "standard");

        setUploadProgress({
          filename: candidate.title,
          current: index + 1,
          total: candidates.length,
          loaded: completedBytes,
          bytesTotal: totalBytes || null,
          percent: totalBytes > 0 ? Math.round((completedBytes / totalBytes) * 100) : null
        });

        const response = await uploadWithProgress({
          url: `${documentUrl}/upload`,
          formData,
          onProgress: (event) => {
            const loaded = completedBytes + event.loaded;
            const bytesTotal = totalBytes || (event.lengthComputable ? event.total : null);
            const percent =
              bytesTotal && bytesTotal > 0 ? Math.min(100, Math.round((loaded / bytesTotal) * 100)) : null;

            setUploadProgress({
              filename: candidate.title,
              current: index + 1,
              total: candidates.length,
              loaded,
              bytesTotal,
              percent
            });
          }
        });

        completedBytes += candidate.file.size;

        if (response.status === 409) {
          skipped.push(candidate.title);
          continue;
        }
      }

      await refreshDocuments();

      if (skipped.length > 0) {
        setError(
          skipped.length === candidates.length
            ? "All selected files were already uploaded."
            : `Skipped ${skipped.length} duplicate file(s).`
        );
      }

      if (skipped.length < candidates.length) {
        setPage(1);
        void runNextJob();
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to upload documents.");
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
  }

  async function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDraggingUpload(false);

    const droppedFiles = await collectDroppedFiles(event.dataTransfer);
    await uploadFiles(droppedFiles);
  }

  async function reprocessDocument(document: DocumentRow) {
    if (!document.latestRevision) {
      return;
    }

    try {
      setError(null);
      await parseJson(
        await fetch(`/api/v1/document-revisions/${document.latestRevision.id}/reprocess`, {
          method: "POST"
        })
      );
      setDetailsById((current) => {
        const next = { ...current };
        delete next[document.id];
        return next;
      });
      await refreshDocuments();
      void runNextJob();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to reprocess document.");
    }
  }

  async function deleteDocument(document: DocumentRow) {
    const confirmed = window.confirm(`Delete ${document.title}?`);

    if (!confirmed) {
      return;
    }

    try {
      setError(null);
      await parseJson(
        await fetch(`/api/v1/documents/${document.id}`, {
          method: "DELETE"
        })
      );
      setExpandedIds((current) => current.filter((id) => id !== document.id));
      setDetailsById((current) => {
        const next = { ...current };
        delete next[document.id];
        return next;
      });
      await refreshDocuments();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to delete document.");
    }
  }

  return (
    <main className="app-shell upload-app-shell">
      <section className="sidebar-shell upload-sidebar-shell">
        <aside className="sidebar upload-sidebar">
          <div className="sidebar-brand">
            <h1>
              <span className="sidebar-brand-mark">
                <img src="/awal-logo.png" alt="Awal logo" />
              </span>
              <span className="sidebar-brand-wordmark">Awal</span>
            </h1>
          </div>

          <nav className="upload-nav" aria-label="Awal sections">
            <Link className="upload-nav-item" href="/">
              <MessageSquare aria-hidden="true" />
              <span>Chat</span>
            </Link>
            <Link className="upload-nav-item active" href="/library" aria-current="page">
              <Library aria-hidden="true" />
              <span>Library</span>
            </Link>
          </nav>

          <div className="sidebar-section upload-sidebar-section">
            <span className="sidebar-label">Library</span>
            <div className="upload-sidebar-stats">
              <div>
                <strong>{summary.total}</strong>
                <span>Documents</span>
              </div>
              <div>
                <strong>{readyCount}</strong>
                <span>Ready</span>
              </div>
              <div>
                <strong>{workingCount}</strong>
                <span>Working</span>
              </div>
              <div>
                <strong>{failedCount}</strong>
                <span>Failed</span>
              </div>
            </div>
          </div>
        </aside>

        <section className="upload-console">
          <header className="upload-console-header">
            <div>
              <h1>Library</h1>
            </div>
            <div className="upload-console-header-side">
              <IngestRuntimePanel
                runtime={ingestRuntime}
                isWaking={isWakingIngestRuntime}
                isStopping={isStoppingIngestRuntime}
                onWake={() => void wakeIngestRuntime()}
                onSleep={() => void sleepIngestRuntime()}
                onRefresh={() => void refreshIngestRuntime().catch(() => undefined)}
              />
              <div className="upload-console-actions compact">
                <button type="button" onClick={() => void runNextJob()} disabled={isRunning}>
                  <Play aria-hidden="true" />
                  <span>{isRunning ? "Running" : "Run queue"}</span>
                </button>
              </div>
              {runQueueStatus ? <p className="upload-queue-status">{runQueueStatus}</p> : null}
            </div>
          </header>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) {
            void uploadFiles(event.target.files);
            event.target.value = "";
          }
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        hidden
        // @ts-expect-error webkitdirectory is supported by Chromium for folder uploads.
        webkitdirectory=""
        onChange={(event) => {
          if (event.target.files) {
            void uploadFiles(event.target.files);
            event.target.value = "";
          }
        }}
      />

      {error ? <p className="upload-console-error">{error}</p> : null}

      <section
        className={`upload-drop-zone${isDraggingUpload ? " dragging" : ""}`}
        aria-label="Upload documents"
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDraggingUpload(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setIsDraggingUpload(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setIsDraggingUpload(false);
          }
        }}
        onDrop={(event) => {
          void handleDrop(event);
        }}
      >
        <div className="upload-drop-icon">
          <FolderUp aria-hidden="true" />
        </div>
        <div>
          <h2>{isUploading ? "Uploading documents" : "Drop documents, folders, or zip files"}</h2>
          <p>
            {uploadProgress
              ? `${uploadProgress.current}/${uploadProgress.total}: ${uploadProgress.filename}`
              : "Files are checked before ingestion, so duplicates are skipped instead of queued."}
          </p>
          {uploadProgress ? (
            <div className="upload-transfer-progress" aria-label="Upload progress">
              <div className="upload-transfer-track">
                <span style={{ width: `${uploadProgress.percent ?? 8}%` }} />
              </div>
              <strong>
                {uploadProgress.percent !== null
                  ? `${uploadProgress.percent}% uploaded`
                  : `${formatBytes(String(uploadProgress.loaded))} uploaded`}
              </strong>
            </div>
          ) : null}
        </div>
        <div className="upload-drop-actions">
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
            <Upload aria-hidden="true" />
            <span>Files</span>
          </button>
          <button type="button" onClick={() => folderInputRef.current?.click()} disabled={isUploading}>
            <FolderUp aria-hidden="true" />
            <span>Folder</span>
          </button>
          <span className="upload-drop-zip">
            <FileArchive aria-hidden="true" />
            <span>Zip</span>
          </span>
        </div>
      </section>

      <section className="upload-console-table" aria-label="Documents">
        <div className="upload-document-list-header">
          <strong>Documents</strong>
          <div className="upload-document-list-tools">
            <span>
              {pagination.total === 0
                ? "0 total"
                : `${(pagination.page - 1) * pagination.pageSize + 1}-${Math.min(
                    pagination.page * pagination.pageSize,
                    pagination.total
                  )} of ${pagination.total}`}
            </span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={pagination.page <= 1}
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}
              disabled={pagination.page >= pagination.totalPages}
            >
              Next
            </button>
          </div>
        </div>
        {isLoading ? (
          <div className="upload-console-empty">Loading documents...</div>
        ) : documents.length === 0 ? (
          <div className="upload-console-empty">No documents uploaded yet.</div>
        ) : (
          documents.map((document) => {
            const detail = detailsById[document.id];
            const expanded = expandedIds.includes(document.id);
            const progress = documentProgress(document);

            return (
              <article className="upload-document-card" key={document.id}>
                <div className="upload-document-row">
                  <div className="upload-document-icon">
                    <FileText aria-hidden="true" />
                  </div>
                  <div className="upload-document-main">
                    <div className="upload-document-title">
                      <strong>{document.title}</strong>
                      <span>{statusLabel(document)}</span>
                    </div>
                    <div className="upload-document-meta">
                      <span>{document.mimeType}</span>
                      <span>{formatBytes(document.latestRevision?.fileSizeBytes ?? null)}</span>
                      <span>{document.latestRevision?.chunkCount ?? 0} chunks</span>
                      <span>{document.latestRevision?.indexCardCount ?? 0} cards</span>
                    </div>
                    {progress.visible ? (
                      <div className="upload-document-progress" aria-label={`Ingestion progress: ${progress.label}`}>
                        <div className="upload-progress-header">
                          <strong>{progress.label}</strong>
                          <span>{progress.detail}</span>
                        </div>
                        <div className="upload-progress-track">
                          <span style={{ width: `${progress.percent}%` }} />
                        </div>
                        <div className="upload-progress-steps">
                          {ingestionSteps.map((step, index) => (
                            <span
                              className={index <= progress.activeIndex ? "active" : ""}
                              key={step.status}
                            >
                              {step.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {document.latestRevision?.qualityNotes ? (
                      <p className="upload-document-note">{document.latestRevision.qualityNotes}</p>
                    ) : document.latestJob?.lastError ? (
                      <p className="upload-document-note error">{document.latestJob.lastError}</p>
                    ) : null}
                  </div>
                  <div className="upload-document-actions">
                    <button type="button" onClick={() => void toggleExpanded(document.id)} title="Details">
                      <ChevronDown aria-hidden="true" className={expanded ? "expanded" : ""} />
                    </button>
                    <a href={`/api/v1/documents/${document.id}/download`} title="Download">
                      Download
                    </a>
                    <button type="button" onClick={() => void reprocessDocument(document)} title="Reprocess">
                      <RotateCw aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => void deleteDocument(document)} title="Delete">
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {expanded && detail?.latestRevision ? (
                  <div className="upload-document-detail">
                    <section className="upload-detail-grid">
                      <div>
                        <h3>Revision</h3>
                        <p>Status: {detail.latestRevision.status}</p>
                        <p>Quality: {detail.latestRevision.extractionQuality ?? "n/a"}</p>
                        <p>Mode: {detail.latestRevision.ingestionMode}</p>
                        <p>Checksum: {detail.latestRevision.checksum ?? "n/a"}</p>
                        <p>Size: {formatBytes(detail.latestRevision.fileSizeBytes)}</p>
                        <p>Updated: {formatDate(detail.latestRevision.updatedAt)}</p>
                      </div>
                      <div>
                        <h3>Jobs</h3>
                        {detail.latestRevision.jobs.length === 0 ? (
                          <p>No jobs recorded.</p>
                        ) : (
                          detail.latestRevision.jobs.map((job) => (
                            <div key={job.id} className="upload-detail-block">
                              <p>{job.status} · attempts {job.attemptCount}</p>
                              <p>{formatDate(job.queuedAt)}</p>
                              {job.lastError ? <p className="upload-document-note error">{job.lastError}</p> : null}
                            </div>
                          ))
                        )}
                      </div>
                    </section>

                    <section className="upload-detail-section">
                      <h3>Index cards</h3>
                      {detail.latestRevision.indexCards.length === 0 ? (
                        <p>No index cards generated.</p>
                      ) : (
                        <div className="upload-detail-list">
                          {detail.latestRevision.indexCards.map((card) => (
                            <article key={card.id} className="upload-detail-item">
                              <strong>{card.title}</strong>
                              <p>{card.kind}{card.chunk ? ` · chunk ${card.chunk.chunkIndex}` : ""}</p>
                              {card.summary ? <p>{card.summary}</p> : null}
                              <p>{card.body}</p>
                              <p>Tags: {card.tags.join(", ") || "n/a"}</p>
                              <p>Aliases: {card.aliases.join(", ") || "n/a"}</p>
                            </article>
                          ))}
                        </div>
                      )}
                    </section>

                    <section className="upload-detail-section">
                      <h3>Chunks</h3>
                      {detail.latestRevision.chunks.length === 0 ? (
                        <p>No chunks generated.</p>
                      ) : (
                        <div className="upload-detail-list">
                          {detail.latestRevision.chunks.map((chunk) => (
                            <article key={chunk.id} className="upload-detail-item">
                              <strong>Chunk {chunk.chunkIndex}</strong>
                              <p>
                                {chunk.tokenCount ?? "n/a"} tokens · {chunk.charCount} chars
                                {chunk.pageStart !== null ? ` · pages ${chunk.pageStart}-${chunk.pageEnd ?? chunk.pageStart}` : ""}
                              </p>
                              {chunk.citationQuotedText ? <p>{chunk.citationQuotedText}</p> : null}
                              <p>{chunk.text}</p>
                            </article>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </section>
        </section>
      </section>
    </main>
  );
}
