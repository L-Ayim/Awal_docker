type RevisionLike = {
  id: string;
  status: string;
  ingestionMode: string;
  storageUri: string | null;
  checksum: string | null;
  fileSizeBytes: bigint | null;
  extractionQuality: string | null;
  reviewFlag: boolean;
  qualityNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type IngestionJobLike = {
  id: string;
  status: string;
  attemptCount: number;
  workerHint: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeRevision(revision: RevisionLike) {
  return {
    id: revision.id,
    status: revision.status,
    extractionQuality: revision.extractionQuality,
    ingestionMode: revision.ingestionMode,
    reviewFlag: revision.reviewFlag,
    qualityNotes: revision.qualityNotes,
    storageUri: revision.storageUri,
    checksum: revision.checksum,
    fileSizeBytes:
      revision.fileSizeBytes !== null && revision.fileSizeBytes !== undefined
        ? revision.fileSizeBytes.toString()
        : null,
    createdAt: revision.createdAt,
    updatedAt: revision.updatedAt
  };
}

export function serializeIngestionJob(job: IngestionJobLike) {
  return {
    id: job.id,
    status: job.status,
    attemptCount: job.attemptCount,
    workerHint: job.workerHint,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    lastError: job.lastError,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}
