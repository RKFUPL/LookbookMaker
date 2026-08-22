import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { constants, createReadStream, createWriteStream, type ReadStream } from "node:fs";
import { access, copyFile, mkdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { catalogStorageRoot, getConfig, requiredProductionStorageRoot } from "@/lib/config";

export class StorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StorageError";
  }
}

export interface ObjectStorage {
  save(key: string, body: Buffer | Uint8Array): Promise<void>;
  saveFile(key: string, filePath: string): Promise<void>;
  read(key: string): ReadStream;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  getPublicUrl(key: string): string;
}

export function validateObjectKey(key: string) {
  const normalized = key.replace(/\\/g, "/");
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new StorageError("Invalid object key.");
  }
  if (normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new StorageError("Invalid object key.");
  }
  return normalized;
}

export class LocalPersistentStorage implements ObjectStorage {
  readonly root: string;

  constructor(root = catalogStorageRoot()) {
    this.root = resolve(root);
  }

  path(key: string) {
    const candidate = resolve(this.root, ...validateObjectKey(key).split("/"));
    const outsideRoot = relative(this.root, candidate);
    if (!outsideRoot || outsideRoot === ".." || outsideRoot.startsWith(`..${sep}`) || isAbsolute(outsideRoot)) {
      throw new StorageError("Invalid object key.");
    }
    return candidate;
  }

  private async ensureParent(key: string) {
    await mkdir(dirname(this.path(key)), { recursive: true });
  }

  async save(key: string, body: Buffer | Uint8Array) {
    await this.ensureParent(key);
    await writeFile(this.path(key), body);
  }

  async saveFile(key: string, filePath: string) {
    await this.ensureParent(key);
    await copyFile(filePath, this.path(key));
  }

  read(key: string) {
    return createReadStream(this.path(key));
  }

  async exists(key: string) {
    try {
      const details = await stat(this.path(key));
      return details.isFile() && details.size > 0;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async delete(key: string) {
    await rm(this.path(key), { recursive: true, force: true });
  }

  getPublicUrl(key: string) {
    return `/api/storage/object?key=${encodeURIComponent(validateObjectKey(key))}`;
  }
}

let storage: LocalPersistentStorage | undefined;

export function catalogStorage() {
  storage ||= new LocalPersistentStorage();
  return storage;
}

function storageCall<T>(operation: string, action: () => Promise<T>) {
  return action().catch((error: unknown) => {
    if (error instanceof StorageError) throw error;
    const detail = error instanceof Error ? error.message : "Unknown storage error.";
    throw new StorageError(`${operation} failed: ${detail}`, { cause: error });
  });
}

export async function assertPersistentCatalogStorage() {
  const root = catalogStorageRoot();
  const requiredRoot = requiredProductionStorageRoot();
  if (process.env.NODE_ENV === "production" && root !== requiredRoot) {
    throw new StorageError(`Persistent catalog storage is not mounted at ${requiredRoot}.`);
  }

  try {
    if (process.env.NODE_ENV !== "production") await mkdir(root, { recursive: true });
    const details = await stat(root);
    if (!details.isDirectory()) throw new Error("Storage path is not a directory.");
    await access(root, constants.R_OK | constants.W_OK);
    const probe = resolve(root, `.rk-storage-probe-${process.pid}-${randomUUID()}`);
    await writeFile(probe, "ok", { flag: "wx" });
    await unlink(probe);
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      throw new StorageError(`Persistent catalog storage is not mounted at ${requiredRoot}.`, { cause: error });
    }
    throw new StorageError(`Catalog storage is unavailable at ${root}.`, { cause: error });
  }
  return root;
}

export type StorageHealth = {
  provider: "local_persistent_disk";
  root: string;
  publicBaseUrl: string;
};

export async function checkStorageHealth(): Promise<StorageHealth> {
  const root = await assertPersistentCatalogStorage();
  return { provider: "local_persistent_disk", root, publicBaseUrl: "/api/storage/object" };
}

export function localObjectPath(key: string) {
  return catalogStorage().path(key);
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

export async function objectHead(key: string) {
  return storageCall("Read local object metadata", async () => {
    const details = await stat(localObjectPath(key));
    return { ContentLength: details.size, ContentType: localContentType(key), ETag: `"local-${details.size}-${details.mtimeMs}"` };
  });
}

export async function objectExists(key: string) {
  return storageCall("Check local object", () => catalogStorage().exists(key));
}

export async function downloadObject(key: string, destination: string) {
  return storageCall("Read local object", () => pipeline(catalogStorage().read(key), createWriteStream(destination)));
}

export async function uploadObject(key: string, body: Buffer | Uint8Array, contentType: string, cacheControl = "public, max-age=31536000, immutable") {
  void contentType;
  void cacheControl;
  return storageCall("Save local object", () => catalogStorage().save(key, body));
}

export async function getPublicAssetUrl(key: string) {
  return catalogStorage().getPublicUrl(key);
}

export async function privateObjectUrl(key: string) {
  return catalogStorage().getPublicUrl(key);
}

export async function objectUrl(key: string) {
  return getPublicAssetUrl(key);
}

export async function privateDownloadUrl(key: string, filename: string) {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "catalog.pdf";
  const expires = Math.floor(Date.now() / 1000) + 5 * 60;
  const token = storageSignature(`${key}:${expires}`);
  return `${catalogStorage().getPublicUrl(key)}&download=1&filename=${encodeURIComponent(safeName)}&expires=${expires}&token=${token}`;
}

export async function copyObject(sourceKey: string, targetKey: string) {
  return storageCall("Copy local object", async () => {
    await mkdir(dirname(localObjectPath(targetKey)), { recursive: true });
    await copyFile(localObjectPath(sourceKey), localObjectPath(targetKey));
  });
}

export async function deletePrefix(prefix: string) {
  const normalizedPrefix = prefix.replace(/[\\/]+$/, "");
  if (!normalizedPrefix) throw new StorageError("Invalid storage prefix.");
  return storageCall("Delete local object prefix", () => catalogStorage().delete(normalizedPrefix));
}
