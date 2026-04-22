import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { pathToFileURL } from "url";

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9-_]/g, "_");
}

export async function persistUpload(params: {
  workspaceId: string;
  collectionId: string;
  filename: string;
  bytes: Uint8Array;
}) {
  const root = process.env.UPLOADS_DIR || "/tmp/awal-uploads";
  const directory = join(
    root,
    safeSegment(params.workspaceId),
    safeSegment(params.collectionId)
  );

  await mkdir(directory, { recursive: true });

  const timestamp = Date.now();
  const filename = `${timestamp}-${safeSegment(params.filename || "upload.bin")}`;
  const absolutePath = join(directory, filename);

  await writeFile(absolutePath, params.bytes);

  const checksum = createHash("sha256").update(params.bytes).digest("hex");

  return {
    storageUri: pathToFileURL(absolutePath).href,
    checksum,
    fileSizeBytes: params.bytes.byteLength
  };
}
