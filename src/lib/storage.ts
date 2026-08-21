import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type ServerSideEncryption,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { appUrl, getConfig } from "@/lib/config";

let client: S3Client | undefined;
let publicClient: S3Client | undefined;

function isLocal() {
  return getConfig().STORAGE_DRIVER === "local";
}

function localRoot() {
  const configured = getConfig().LOCAL_STORAGE_ROOT;
  return configured.match(/^[A-Za-z]:[\\/]|^\\\\/) ? configured : `${process.cwd()}\\${configured}`;
}

export function localObjectPath(key: string) {
  if (!key || key.includes("..") || key.startsWith("/") || key.startsWith("\\")) throw new Error("Invalid object key.");
  return `${localRoot()}\\${key.replace(/[\\/]+/g, "\\")}`;
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

function storageClient() {
  if (client) return client;
  const config = getConfig();
  client = new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT || undefined,
    forcePathStyle: config.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

function browserStorageClient() {
  if (publicClient) return publicClient;
  const config = getConfig();
  publicClient = new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_PUBLIC_ENDPOINT || config.S3_ENDPOINT || undefined,
    forcePathStyle: config.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
  });
  return publicClient;
}

export async function signedUploadUrl(key: string, contentType: string, cacheControl?: string) {
  if (isLocal()) return `${appUrl()}/api/storage/upload?key=${encodeURIComponent(key)}`;
  const config = getConfig();
  const command = new PutObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: key,
    ContentType: contentType,
    CacheControl: cacheControl,
    ServerSideEncryption: (process.env.S3_SERVER_SIDE_ENCRYPTION || undefined) as ServerSideEncryption | undefined,
  });
  return getSignedUrl(browserStorageClient(), command, { expiresIn: 15 * 60 });
}

export async function objectHead(key: string) {
  if (isLocal()) {
    const details = await stat(localObjectPath(key));
    return { ContentLength: details.size, ContentType: localContentType(key), ETag: `"local-${details.size}-${details.mtimeMs}"` };
  }
  return storageClient().send(new HeadObjectCommand({ Bucket: getConfig().S3_BUCKET, Key: key }));
}

export async function readObjectPrefix(key: string, length = 16) {
  if (isLocal()) {
    const handle = await (await import("node:fs/promises")).open(localObjectPath(key), "r");
    try {
      const buffer = Buffer.alloc(length);
      const result = await handle.read(buffer, 0, length, 0);
      return buffer.subarray(0, result.bytesRead);
    } finally {
      await handle.close();
    }
  }
  const response = await storageClient().send(
    new GetObjectCommand({ Bucket: getConfig().S3_BUCKET, Key: key, Range: `bytes=0-${length - 1}` }),
  );
  if (!response.Body) throw new Error("Storage returned an empty object.");
  return Buffer.from(await response.Body.transformToByteArray());
}

export async function downloadObject(key: string, destination: string) {
  if (isLocal()) {
    await pipeline(createReadStream(localObjectPath(key)), createWriteStream(destination));
    return;
  }
  const response = await storageClient().send(new GetObjectCommand({ Bucket: getConfig().S3_BUCKET, Key: key }));
  if (!response.Body) throw new Error("Storage returned an empty object.");
  await pipeline(response.Body as Readable, createWriteStream(destination));
}

export async function uploadObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
  cacheControl = "public, max-age=31536000, immutable",
) {
  if (isLocal()) {
    const destination = localObjectPath(key);
    await mkdir(destination.slice(0, destination.lastIndexOf("\\")), { recursive: true });
    await (await import("node:fs/promises")).writeFile(destination, body);
    return;
  }
  await storageClient().send(
    new PutObjectCommand({
      Bucket: getConfig().S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl,
      ServerSideEncryption: (process.env.S3_SERVER_SIDE_ENCRYPTION || undefined) as ServerSideEncryption | undefined,
    }),
  );
}

export async function objectUrl(key: string) {
  const config = getConfig();
  if (isLocal()) return `${appUrl()}/api/storage/object?key=${encodeURIComponent(key)}`;
  if (config.STORAGE_PUBLIC_BASE_URL) {
    return `${config.STORAGE_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
  return getSignedUrl(
    browserStorageClient(),
    new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }),
    { expiresIn: config.SIGNED_URL_TTL_SECONDS },
  );
}

export async function privateDownloadUrl(key: string, filename: string) {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "catalog.pdf";
  if (isLocal()) {
    const expires = Math.floor(Date.now() / 1000) + 5 * 60;
    const token = storageSignature(`${key}:${expires}`);
    return `${appUrl()}/api/storage/object?key=${encodeURIComponent(key)}&download=1&filename=${encodeURIComponent(safeName)}&expires=${expires}&token=${token}`;
  }
  return getSignedUrl(
    browserStorageClient(),
    new GetObjectCommand({
      Bucket: getConfig().S3_BUCKET,
      Key: key,
      ResponseContentType: "application/pdf",
      ResponseContentDisposition: `attachment; filename="${safeName}"`,
    }),
    { expiresIn: 5 * 60 },
  );
}

export async function copyObject(sourceKey: string, targetKey: string) {
  if (isLocal()) {
    const destination = localObjectPath(targetKey);
    await mkdir(destination.slice(0, destination.lastIndexOf("\\")), { recursive: true });
    await copyFile(localObjectPath(sourceKey), destination);
    return;
  }
  const bucket = getConfig().S3_BUCKET;
  const copySource = `${bucket}/${sourceKey.split("/").map(encodeURIComponent).join("/")}`;
  await storageClient().send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: targetKey,
      CopySource: copySource,
      MetadataDirective: "COPY",
    }),
  );
}

export async function deletePrefix(prefix: string) {
  if (isLocal()) {
    await rm(localObjectPath(prefix.replace(/\/$/, "")), { recursive: true, force: true });
    return;
  }
  const bucket = getConfig().S3_BUCKET;
  let continuationToken: string | undefined;
  do {
    const listed = await storageClient().send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }),
    );
    const keys = (listed.Contents || []).flatMap((item) => (item.Key ? [{ Key: item.Key }] : []));
    if (keys.length) {
      await storageClient().send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }));
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
}

export async function writeLocalObject(key: string, body: ReadableStream<Uint8Array>) {
  if (!isLocal()) throw new Error("Local storage driver is not enabled.");
  const destination = localObjectPath(key);
  await mkdir(destination.slice(0, destination.lastIndexOf("\\")), { recursive: true });
  await pipeline((await import("node:stream")).Readable.fromWeb(body as never), createWriteStream(destination));
}
