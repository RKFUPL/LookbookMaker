import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, open, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getConfig, storageProvider, type StorageProvider } from "@/lib/config";

export class StorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StorageError";
  }
}

type StorageSettings = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  publicBaseUrl: string;
};

let client: S3Client | undefined;

function localRoot() {
  const configured = getConfig().LOCAL_STORAGE_ROOT.trim();
  return isAbsolute(configured) ? resolve(configured) : resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

export function isLocalStorage() {
  return storageProvider() === "local";
}

function settings(): StorageSettings {
  const config = getConfig();
  const endpoint = config.R2_ENDPOINT || config.S3_ENDPOINT;
  const region = config.R2_REGION || config.S3_REGION || "auto";
  const bucket = config.R2_BUCKET || config.S3_BUCKET;
  const accessKeyId = config.R2_ACCESS_KEY_ID || config.S3_ACCESS_KEY_ID;
  const secretAccessKey = config.R2_SECRET_ACCESS_KEY || config.S3_SECRET_ACCESS_KEY;
  const publicBaseUrl = config.R2_PUBLIC_BASE_URL || config.STORAGE_PUBLIC_BASE_URL;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new StorageError("R2/S3 storage is not fully configured.");
  }
  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: config.R2_FORCE_PATH_STYLE === "true" || config.S3_FORCE_PATH_STYLE === "true",
    publicBaseUrl: publicBaseUrl || "",
  };
}

function s3Client() {
  if (!client) {
    const config = settings();
    client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }
  return client;
}

function s3Config() {
  return settings();
}

export type StorageHealth = {
  provider: StorageProvider;
  bucket: string;
  publicBaseUrl: string;
  checkedObjectKey?: string;
};

export async function checkStorageHealth(): Promise<StorageHealth> {
  const config = getConfig();
  const provider = storageProvider(config);
  if (provider === "local") {
    return { provider, bucket: "local filesystem", publicBaseUrl: "" };
  }
  return storageCall("Check R2 storage", async () => {
    const storage = s3Config();
    const healthcheckKey = config.R2_HEALTHCHECK_KEY?.trim();
    if (healthcheckKey) {
      await s3Client().send(new HeadObjectCommand({ Bucket: storage.bucket, Key: validateObjectKey(healthcheckKey) }));
      return { provider, bucket: storage.bucket, publicBaseUrl: storage.publicBaseUrl, checkedObjectKey: healthcheckKey };
    }
    await s3Client().send(new HeadBucketCommand({ Bucket: storage.bucket }));
    return { provider, bucket: storage.bucket, publicBaseUrl: storage.publicBaseUrl };
  });
}

async function storageCall<T>(operation: string, action: () => Promise<T>) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof StorageError) throw error;
    const detail = error instanceof Error ? error.message : "Unknown storage error.";
    throw new StorageError(`${operation} failed: ${detail}`, { cause: error });
  }
}

function validateObjectKey(key: string) {
  const normalized = key.replace(/\\/g, "/");
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error("Invalid object key.");
  }
  if (normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Invalid object key.");
  }
  return normalized;
}

export function localObjectPath(key: string) {
  const root = localRoot();
  const candidate = resolve(root, ...validateObjectKey(key).split("/"));
  const outsideRoot = relative(root, candidate);
  if (!outsideRoot || outsideRoot === ".." || outsideRoot.startsWith(`..${sep}`) || isAbsolute(outsideRoot)) {
    throw new Error("Invalid object key.");
  }
  return candidate;
}

function localContentType(key: string) {
  const extension = key.split(".").pop()?.toLowerCase();
  return extension === "pdf" ? "application/pdf" : extension === "png" ? "image/png" : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : "image/webp";
}

function storageSignature(value: string) {
  return createHmac("sha256", getConfig().AUTH_SECRET).update(value).digest("hex");
}

export function verifyLocalDownloadToken(key: string, expires: string, token: string) {
  const expiry = Number(expires);
  if (!Number.isSafeInteger(expiry) || expiry < Math.floor(Date.now() / 1000)) return false;
  const expected = storageSignature(`${key}:${expiry}`);
  const actual = Buffer.from(token);
  const reference = Buffer.from(expected);
  return actual.length === reference.length && timingSafeEqual(actual, reference);
}

async function ensureParent(key: string) {
  await mkdir(dirname(localObjectPath(key)), { recursive: true });
}

function encodedKey(key: string) {
  return validateObjectKey(key).split("/").map(encodeURIComponent).join("/");
}

function localObjectUrl(key: string) {
  return `/api/storage/object?key=${encodeURIComponent(validateObjectKey(key))}`;
}

async function signedObjectUrl(key: string, filename?: string) {
  const config = s3Config();
  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: validateObjectKey(key),
    ...(filename ? { ResponseContentDisposition: `attachment; filename="${filename}"` } : {}),
  });
  return getSignedUrl(s3Client(), command, { expiresIn: getConfig().SIGNED_URL_TTL_SECONDS });
}

export async function signedUploadUrl(key: string, contentType: string, cacheControl?: string) {
  if (isLocalStorage()) return localObjectUrl(key).replace("/api/storage/object", "/api/storage/upload");
  return storageCall("Create upload URL", async () => {
    const config = s3Config();
    const command = new PutObjectCommand({
      Bucket: config.bucket,
      Key: validateObjectKey(key),
      ContentType: contentType,
      ...(cacheControl ? { CacheControl: cacheControl } : {}),
    });
    return getSignedUrl(s3Client(), command, { expiresIn: getConfig().SIGNED_URL_TTL_SECONDS });
  });
}

export async function objectHead(key: string) {
  if (isLocalStorage()) {
    return storageCall("Read local object metadata", async () => {
      const details = await stat(localObjectPath(key));
      return { ContentLength: details.size, ContentType: localContentType(key), ETag: `"local-${details.size}-${details.mtimeMs}"` };
    });
  }
  return storageCall("Read object metadata", async () => {
    const config = s3Config();
    const response = await s3Client().send(new HeadObjectCommand({ Bucket: config.bucket, Key: validateObjectKey(key) }));
    return { ContentLength: response.ContentLength || 0, ContentType: response.ContentType || localContentType(key), ETag: response.ETag || "" };
  });
}

export async function readObjectPrefix(key: string, length = 16) {
  if (isLocalStorage()) {
    return storageCall("Read local object prefix", async () => {
      const handle = await open(localObjectPath(key), "r");
      try {
        const buffer = Buffer.alloc(length);
        const result = await handle.read(buffer, 0, length, 0);
        return buffer.subarray(0, result.bytesRead);
      } finally {
        await handle.close();
      }
    });
  }
  return storageCall("Read object prefix", async () => {
    const config = s3Config();
    const response = await s3Client().send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: validateObjectKey(key),
      Range: `bytes=0-${Math.max(0, length - 1)}`,
    }));
    if (!response.Body) throw new Error("Object body is empty.");
    return Buffer.from(await response.Body.transformToByteArray());
  });
}

export async function downloadObject(key: string, destination: string) {
  return storageCall("Download object", async () => {
    if (isLocalStorage()) {
      await pipeline(createReadStream(localObjectPath(key)), createWriteStream(destination));
      return;
    }
    const config = s3Config();
    const response = await s3Client().send(new GetObjectCommand({ Bucket: config.bucket, Key: validateObjectKey(key) }));
    if (!response.Body) throw new Error("Object body is empty.");
    await pipeline(response.Body as unknown as NodeJS.ReadableStream, createWriteStream(destination));
  });
}

export async function uploadObject(key: string, body: Buffer | Uint8Array, contentType: string, cacheControl = "public, max-age=31536000, immutable") {
  return storageCall("Upload object", async () => {
    if (isLocalStorage()) {
      await ensureParent(key);
      await writeFile(localObjectPath(key), body);
      return;
    }
    const config = s3Config();
    await s3Client().send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: validateObjectKey(key),
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl,
    }));
  });
}

export async function uploadFile(key: string, filePath: string, contentType: string, cacheControl = "private, max-age=0, no-cache") {
  return storageCall("Upload file", async () => {
    if (isLocalStorage()) {
      await ensureParent(key);
      await copyFile(filePath, localObjectPath(key));
      return;
    }
    const config = s3Config();
    await s3Client().send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: validateObjectKey(key),
      Body: createReadStream(filePath),
      ContentType: contentType,
      CacheControl: cacheControl,
    }));
  });
}

export async function getPublicAssetUrl(key: string) {
  if (isLocalStorage()) return localObjectUrl(key);
  return storageCall("Create public object URL", async () => {
    const config = s3Config();
    if (!config.publicBaseUrl) throw new StorageError("R2_PUBLIC_BASE_URL is required for public catalog assets.");
    return `${config.publicBaseUrl.replace(/\/$/, "")}/${encodedKey(key)}`;
  });
}

export async function publicObjectUrl(key: string) {
  return getPublicAssetUrl(key);
}

export async function privateObjectUrl(key: string) {
  if (isLocalStorage()) return localObjectUrl(key);
  return storageCall("Create private object URL", () => signedObjectUrl(key));
}

export async function objectUrl(key: string) {
  return getPublicAssetUrl(key);
}

export async function privateDownloadUrl(key: string, filename: string) {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "catalog.pdf";
  if (!isLocalStorage()) return storageCall("Create private download URL", () => signedObjectUrl(key, safeName));
  const expires = Math.floor(Date.now() / 1000) + 5 * 60;
  const token = storageSignature(`${key}:${expires}`);
  return `${localObjectUrl(key)}&download=1&filename=${encodeURIComponent(safeName)}&expires=${expires}&token=${token}`;
}

export async function copyObject(sourceKey: string, targetKey: string) {
  return storageCall("Copy object", async () => {
    if (isLocalStorage()) {
      await ensureParent(targetKey);
      await copyFile(localObjectPath(sourceKey), localObjectPath(targetKey));
      return;
    }
    const config = s3Config();
    await s3Client().send(new CopyObjectCommand({
      Bucket: config.bucket,
      Key: validateObjectKey(targetKey),
      CopySource: `${config.bucket}/${encodedKey(sourceKey)}`,
    }));
  });
}

export async function deletePrefix(prefix: string) {
  const normalizedPrefix = prefix.replace(/[\\/]+$/, "");
  if (!normalizedPrefix) throw new Error("Invalid storage prefix.");
  if (isLocalStorage()) {
    return storageCall("Delete local object prefix", () => rm(localObjectPath(normalizedPrefix), { recursive: true, force: true }));
  }
  return storageCall("Delete object prefix", async () => {
    const config = s3Config();
    let continuationToken: string | undefined;
    do {
      const listed = await s3Client().send(new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: `${validateObjectKey(normalizedPrefix)}/`,
        ContinuationToken: continuationToken,
      }));
      const keys = (listed.Contents || []).flatMap((entry) => entry.Key ? [{ Key: entry.Key }] : []);
      if (keys.length) await s3Client().send(new DeleteObjectsCommand({ Bucket: config.bucket, Delete: { Objects: keys } }));
      continuationToken = listed.NextContinuationToken;
    } while (continuationToken);
  });
}

export async function writeLocalObject(key: string, body: ReadableStream<Uint8Array>) {
  if (!isLocalStorage()) throw new StorageError("Direct uploads must use a signed R2/S3 URL.");
  return storageCall("Write local object", async () => {
    await ensureParent(key);
    await pipeline(Readable.fromWeb(body as never), createWriteStream(localObjectPath(key)));
  });
}
