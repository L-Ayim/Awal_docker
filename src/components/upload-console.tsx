"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Play, RefreshCw, RotateCw, Trash2, Upload } from "lucide-react";

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

type DocumentsResponse = {
  documents: DocumentRow[];
};

type UploadableFile = File & {
  webkitRelativePath?: string;
};

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(json?.message || json?.error || `Request failed with status ${response.status}.`);
  }

  return json as T;
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

export function UploadConsole() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const documentUrl = useMemo(() => {
    if (!bootstrap) {
      return null;
    }

    return `/api/v1/workspaces/${bootstrap.workspace.id}/collections/${bootstrap.collection.id}/documents`;
  }, [bootstrap]);

  const refreshDocuments = useCallback(async () => {
    if (!documentUrl) {
      return;
    }

    const payload = await parseJson<DocumentsResponse>(await fetch(documentUrl));
    setDocuments(payload.documents);
  }, [documentUrl]);

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
  }, [documentUrl, refreshDocuments]);

  async function runNextJob() {
    try {
      setIsRunning(true);
      setError(null);
      await parseJson(await fetch("/api/v1/ingestion-jobs/run-next", { method: "POST" }));
      await refreshDocuments();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to run ingestion.");
    } finally {
      setIsRunning(false);
    }
  }

  async function uploadFiles(files: FileList | File[]) {
    if (!documentUrl || !files.length) {
      return;
    }

    try {
      setIsUploading(true);
      setError(null);

      for (const file of Array.from(files) as UploadableFile[]) {
        const formData = new FormData();
        formData.set("file", file);
        formData.set("title", file.webkitRelativePath?.trim() || file.name);
        formData.set("ingestionMode", "standard");

        await parseJson(
          await fetch(`${documentUrl}/upload`, {
            method: "POST",
            body: formData
          })
        );
      }

      await refreshDocuments();
      void runNextJob();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to upload documents.");
    } finally {
      setIsUploading(false);
    }
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
      await refreshDocuments();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to delete document.");
    }
  }

  return (
    <main className="upload-console">
      <header className="upload-console-header">
        <div>
          <p className="upload-console-kicker">Awal document console</p>
          <h1>Upload Library</h1>
        </div>
        <div className="upload-console-actions">
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
            <Upload aria-hidden="true" />
            <span>{isUploading ? "Uploading" : "Upload files"}</span>
          </button>
          <button type="button" onClick={() => folderInputRef.current?.click()} disabled={isUploading}>
            <Upload aria-hidden="true" />
            <span>Upload folder</span>
          </button>
          <button type="button" onClick={() => void runNextJob()} disabled={isRunning}>
            <Play aria-hidden="true" />
            <span>{isRunning ? "Running" : "Run next job"}</span>
          </button>
          <button type="button" onClick={() => void refreshDocuments()} disabled={!documentUrl}>
            <RefreshCw aria-hidden="true" />
            <span>Refresh</span>
          </button>
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

      <section className="upload-console-summary" aria-label="Document summary">
        <div>
          <strong>{documents.length}</strong>
          <span>Documents</span>
        </div>
        <div>
          <strong>{documents.filter((document) => statusLabel(document) === "completed" || document.status === "ready").length}</strong>
          <span>Ready</span>
        </div>
        <div>
          <strong>{documents.filter((document) => ["queued", "processing", "uploaded"].includes(statusLabel(document))).length}</strong>
          <span>Working</span>
        </div>
      </section>

      <section className="upload-console-table" aria-label="Documents">
        {isLoading ? (
          <div className="upload-console-empty">Loading documents...</div>
        ) : documents.length === 0 ? (
          <div className="upload-console-empty">No documents uploaded yet.</div>
        ) : (
          documents.map((document) => (
            <article className="upload-document-row" key={document.id}>
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
                {document.latestRevision?.qualityNotes ? (
                  <p className="upload-document-note">{document.latestRevision.qualityNotes}</p>
                ) : document.latestJob?.lastError ? (
                  <p className="upload-document-note error">{document.latestJob.lastError}</p>
                ) : null}
              </div>
              <div className="upload-document-actions">
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
            </article>
          ))
        )}
      </section>
    </main>
  );
}
