import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, open, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { ApiError } from "@/lib/http";

const PDF_SIGNATURE = Buffer.from("%PDF-");
const STORAGE_PREFIX = "lookbooks";

export type LocalPdfMetadata = {
  storageProvider: "local";
  sourceType: "local";
  sourcePdfUrl: "";
  storageKey: string;
  originalFilename: string;
  storageContentType: "application/pdf";
  sourceSize: number;
  uploadedAt: Date;
};

export function localPdfStorageRoot() {
  const configured = process.env.LOOKBOOK_STORAGE_DIR?.trim();
  if (configured) return path.resolve(configured);
  if (process.env.NODE_ENV === "production") {
    throw new ApiError(503, "Local PDF storage is not configured.", "LOCAL_STORAGE_NOT_CONFIGURED");
  }
  return path.join(homedir(), ".lookbook-maker", "pdfs");
}

export function resolveLocalPdfPath(storageKey: string) {
  if (!storageKey || storageKey.includes("\\") || path.posix.isAbsolute(storageKey)) {
    throw new ApiError(422, "Catalog contains an invalid local PDF reference.", "LOCAL_STORAGE_KEY_INVALID");
  }
  const normalized = path.posix.normalize(storageKey);
  if (normalized !== storageKey || !normalized.startsWith(`${STORAGE_PREFIX}/`) || normalized.includes("../")) {
    throw new ApiError(422, "Catalog contains an invalid local PDF reference.", "LOCAL_STORAGE_KEY_INVALID");
  }
  const root = localPdfStorageRoot();
  const resolved = path.resolve(root, ...normalized.split("/"));
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ApiError(422, "Catalog contains an invalid local PDF reference.", "LOCAL_STORAGE_KEY_INVALID");
  }
  return resolved;
}

export async function ensureLocalPdfStorage() {
  const root = localPdfStorageRoot();
  await mkdir(root, { recursive: true });
  return root;
}

export async function storeLocalPdf(file: File): Promise<LocalPdfMetadata> {
  await ensureLocalPdfStorage();
  const now = new Date();
  const storageKey = `${STORAGE_PREFIX}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.pdf`;
  const destination = resolveLocalPdfPath(storageKey);
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await writeFile(destination, Buffer.from(await file.arrayBuffer()), { flag: "wx", mode: 0o640 });
    const handle = await open(destination, "r");
    try {
      const signature = Buffer.alloc(PDF_SIGNATURE.length);
      await handle.read(signature, 0, signature.length, 0);
      if (!signature.equals(PDF_SIGNATURE)) throw new Error("invalid PDF signature after write");
    } finally {
      await handle.close();
    }
    return {
      storageProvider: "local",
      sourceType: "local",
      sourcePdfUrl: "",
      storageKey,
      originalFilename: file.name.slice(0, 255),
      storageContentType: "application/pdf",
      sourceSize: file.size,
      uploadedAt: now,
    };
  } catch (error) {
    await unlink(destination).catch(() => undefined);
    throw error instanceof ApiError ? error : new ApiError(500, "The PDF could not be written to local storage.", "LOCAL_STORAGE_WRITE_FAILED");
  }
}

export async function removeLocalPdf(storageKey: string) {
  const target = resolveLocalPdfPath(storageKey);
  await unlink(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export async function persistAfterLocalPdfWrite<T>(storageKey: string, persist: () => Promise<T>) {
  try {
    return await persist();
  } catch {
    try {
      await removeLocalPdf(storageKey);
    } catch {
      throw new ApiError(500, "Catalog save failed and the stored PDF could not be cleaned up. An administrator must reconcile the orphaned local file before retrying.", "LOCAL_STORAGE_ORPHAN_POSSIBLE");
    }
    throw new ApiError(500, "Catalog save failed; the newly stored PDF was removed safely. You can retry this upload.", "CATALOG_SAVE_FAILED");
  }
}

export async function copyLocalPdf(storageKey: string): Promise<Pick<LocalPdfMetadata, "storageKey" | "storageProvider" | "sourceType" | "sourcePdfUrl" | "storageContentType" | "sourceSize" | "uploadedAt">> {
  const { target, details } = await localPdfStat(storageKey);
  const now = new Date();
  const newKey = `${STORAGE_PREFIX}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.pdf`;
  const destination = resolveLocalPdfPath(newKey);
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await copyFile(target, destination, 1);
    return {
      storageProvider: "local",
      sourceType: "local",
      sourcePdfUrl: "",
      storageKey: newKey,
      storageContentType: "application/pdf",
      sourceSize: details.size,
      uploadedAt: now,
    };
  } catch {
    await unlink(destination).catch(() => undefined);
    throw new ApiError(500, "The catalog PDF could not be copied in local storage.", "LOCAL_STORAGE_COPY_FAILED");
  }
}

async function localPdfStat(storageKey: string) {
  const target = resolveLocalPdfPath(storageKey);
  let details;
  try {
    details = await stat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ApiError(404, "The stored PDF file was not found.", "LOCAL_PDF_NOT_FOUND");
    throw new ApiError(500, "The stored PDF file could not be read.", "LOCAL_PDF_READ_FAILED");
  }
  if (!details.isFile() || details.size < PDF_SIGNATURE.length) throw new ApiError(422, "The stored catalog file is not a valid PDF.", "LOCAL_PDF_INVALID");
  const handle = await open(target, "r");
  try {
    const signature = Buffer.alloc(PDF_SIGNATURE.length);
    await handle.read(signature, 0, signature.length, 0);
    if (!signature.equals(PDF_SIGNATURE)) throw new ApiError(422, "The stored catalog file is not a valid PDF.", "LOCAL_PDF_INVALID");
  } finally {
    await handle.close();
  }
  return { target, details };
}

function byteRange(value: string | null, size: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return "invalid" as const;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return "invalid" as const;
  end = Math.min(end, size - 1);
  return { start, end };
}

export async function localPdfResponse(storageKey: string, request: Request, downloadFilename?: string) {
  const { target, details } = await localPdfStat(storageKey);
  const range = byteRange(request.headers.get("range"), details.size);
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Type": "application/pdf",
    "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=86400",
    "Last-Modified": details.mtime.toUTCString(),
    Vary: "Range",
    "X-Content-Type-Options": "nosniff",
  });
  if (downloadFilename) headers.set("Content-Disposition", `attachment; filename="${downloadFilename.replace(/[^a-zA-Z0-9._-]/g, "-")}"`);
  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${details.size}`);
    return new Response(null, { status: 416, headers });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? details.size - 1;
  const length = end - start + 1;
  headers.set("Content-Length", String(length));
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${details.size}`);
  if (request.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
  const stream = Readable.toWeb(createReadStream(target, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(stream, { status: range ? 206 : 200, headers });
}

export async function checkLocalPdfStorage() {
  const root = await ensureLocalPdfStorage();
  const probe = path.join(root, `.health-${randomUUID()}`);
  await writeFile(probe, "ok", { flag: "wx", mode: 0o600 });
  await unlink(probe);
  return root;
}
