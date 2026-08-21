import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, open, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getConfig } from "@/lib/config";

function localRoot() {
  const configured = getConfig().LOCAL_STORAGE_ROOT.trim();
  return isAbsolute(configured) ? resolve(configured) : resolve(/* turbopackIgnore: true */ process.cwd(), configured);
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

export async function signedUploadUrl(key: string, _contentType: string, _cacheControl?: string) {
  void _contentType;
  void _cacheControl;
  return `/api/storage/upload?key=${encodeURIComponent(key)}`;
}

export async function objectHead(key: string) {
  const details = await stat(localObjectPath(key));
  return { ContentLength: details.size, ContentType: localContentType(key), ETag: `"local-${details.size}-${details.mtimeMs}"` };
}

export async function readObjectPrefix(key: string, length = 16) {
  const handle = await open(localObjectPath(key), "r");
  try {
    const buffer = Buffer.alloc(length);
    const result = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
}

export async function downloadObject(key: string, destination: string) {
  await pipeline(createReadStream(localObjectPath(key)), createWriteStream(destination));
}

export async function uploadObject(
  key: string,
  body: Buffer | Uint8Array,
  _contentType: string,
  _cacheControl = "public, max-age=31536000, immutable",
) {
  void _contentType;
  void _cacheControl;
  await ensureParent(key);
  await writeFile(localObjectPath(key), body);
}

export async function uploadFile(
  key: string,
  filePath: string,
  _contentType: string,
  _cacheControl = "private, max-age=0, no-cache",
) {
  void _contentType;
  void _cacheControl;
  await ensureParent(key);
  await copyFile(filePath, localObjectPath(key));
}

export async function objectUrl(key: string) {
  return `/api/storage/object?key=${encodeURIComponent(key)}`;
}

export async function privateDownloadUrl(key: string, filename: string) {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "catalog.pdf";
  const expires = Math.floor(Date.now() / 1000) + 5 * 60;
  const token = storageSignature(`${key}:${expires}`);
  return `/api/storage/object?key=${encodeURIComponent(key)}&download=1&filename=${encodeURIComponent(safeName)}&expires=${expires}&token=${token}`;
}

export async function copyObject(sourceKey: string, targetKey: string) {
  await ensureParent(targetKey);
  await copyFile(localObjectPath(sourceKey), localObjectPath(targetKey));
}

export async function deletePrefix(prefix: string) {
  const normalizedPrefix = prefix.replace(/[\\/]+$/, "");
  if (!normalizedPrefix) throw new Error("Invalid storage prefix.");
  await rm(localObjectPath(normalizedPrefix), { recursive: true, force: true });
}

export async function writeLocalObject(key: string, body: ReadableStream<Uint8Array>) {
  await ensureParent(key);
  await pipeline(Readable.fromWeb(body as never), createWriteStream(localObjectPath(key)));
}
