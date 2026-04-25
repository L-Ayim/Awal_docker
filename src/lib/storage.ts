import { randomUUID, createHash } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { basename, join } from "path";
import { pathToFileURL, fileURLToPath } from "url";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function parseBucketAndKey(storageUri: string) {
  const match = storageUri.match(/^s3:\/\/([^/]+)\/(.+)$/i);

  if (!match) {
    throw new Error("Unsupported object storage URI.");
  }

  return {
    bucket: match[1],
    key: match[2]
  };
}

function getObjectStorageConfig() {
  const bucket =
    process.env.BUCKET_NAME?.trim() ||
    process.env.S3_BUCKET_NAME?.trim() ||
    process.env.AWS_BUCKET_NAME?.trim() ||
    "";
  const endpoint = process.env.AWS_ENDPOINT_URL_S3?.trim() || process.env.S3_ENDPOINT?.trim() || "";
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim() || "";
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim() || "";
  const region = process.env.AWS_REGION?.trim() || "auto";

  return {
    configured: Boolean(bucket && endpoint && accessKeyId && secretAccessKey),
    bucket,
    endpoint,
    accessKeyId,
    secretAccessKey,
    region
  };
}

let cachedClient: S3Client | null = null;

function getObjectStorageClient() {
  const config = getObjectStorageConfig();

  if (!config.configured) {
    throw new Error("Object storage is not configured.");
  }

  if (!cachedClient) {
    cachedClient = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
  }

  return {
    client: cachedClient,
    bucket: config.bucket
  };
}

async function streamToBuffer(body: unknown) {
  if (!body) {
    return Buffer.alloc(0);
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return Buffer.from(await body.arrayBuffer());
  }

  if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === "function") {
    return Buffer.from(await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray());
  }

  const chunks: Buffer[] = [];

  for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

export function getStorageRuntimeStatus() {
  const objectStorage = getObjectStorageConfig();

  return {
    mode: objectStorage.configured ? "object" : "local",
    objectStorageConfigured: objectStorage.configured,
    bucket: objectStorage.configured ? objectStorage.bucket : null
  };
}

export async function persistUpload(params: {
  workspaceId: string;
  collectionId: string;
  filename: string;
  bytes: Uint8Array;
}) {
  const checksum = createHash("sha256").update(params.bytes).digest("hex");
  const objectStorage = getObjectStorageConfig();

  if (objectStorage.configured) {
    const { client, bucket } = getObjectStorageClient();
    const timestamp = Date.now();
    const key = [
      "uploads",
      safeSegment(params.workspaceId),
      safeSegment(params.collectionId),
      `${timestamp}-${safeSegment(params.filename || "upload.bin")}`
    ].join("/");

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: params.bytes
      })
    );

    return {
      storageUri: `s3://${bucket}/${key}`,
      checksum,
      fileSizeBytes: params.bytes.byteLength
    };
  }

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

  return {
    storageUri: pathToFileURL(absolutePath).href,
    checksum,
    fileSizeBytes: params.bytes.byteLength
  };
}

export async function readStoredBytes(storageUri: string | null) {
  if (!storageUri) {
    throw new Error("Missing storage URI.");
  }

  if (storageUri.startsWith("file://")) {
    const absolutePath = fileURLToPath(storageUri);
    return {
      bytes: await readFile(absolutePath),
      filename: basename(absolutePath),
      mimeType: null as string | null
    };
  }

  if (storageUri.startsWith("s3://")) {
    const { client } = getObjectStorageClient();
    const { bucket, key } = parseBucketAndKey(storageUri);
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key
      })
    );

    return {
      bytes: await streamToBuffer(response.Body),
      filename: basename(key),
      mimeType: response.ContentType ?? null
    };
  }

  if (/^https?:\/\//i.test(storageUri)) {
    const response = await fetch(storageUri);

    if (!response.ok) {
      throw new Error(`Failed to fetch remote file: ${response.status}`);
    }

    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      filename: basename(new URL(storageUri).pathname) || "remote-file",
      mimeType: response.headers.get("content-type")
    };
  }

  throw new Error("Unsupported storage URI.");
}

export async function deleteStoredObject(storageUri: string | null) {
  if (!storageUri) {
    return;
  }

  if (storageUri.startsWith("file://")) {
    await rm(fileURLToPath(storageUri), { force: true }).catch(() => undefined);
    return;
  }

  if (storageUri.startsWith("s3://")) {
    const { client } = getObjectStorageClient();
    const { bucket, key } = parseBucketAndKey(storageUri);

    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key
      })
    );
  }
}

export async function materializeStoredFile(params: {
  storageUri: string | null;
  filenameHint?: string | null;
}) {
  if (!params.storageUri) {
    throw new Error("Missing storage URI.");
  }

  if (params.storageUri.startsWith("file://")) {
    const absolutePath = fileURLToPath(params.storageUri);

    return {
      absolutePath,
      bytes: await readFile(absolutePath),
      filename: basename(absolutePath),
      cleanup: async () => {}
    };
  }

  const stored = await readStoredBytes(params.storageUri);
  const filename = safeSegment(params.filenameHint || stored.filename || `upload-${randomUUID()}`);
  const absolutePath = join(tmpdir(), `awal-${randomUUID()}-${filename}`);

  await writeFile(absolutePath, stored.bytes);

  return {
    absolutePath,
    bytes: stored.bytes,
    filename,
    cleanup: async () => {
      await rm(absolutePath, { force: true }).catch(() => undefined);
    }
  };
}
