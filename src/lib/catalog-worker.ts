import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, open, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { connectDb } from "@/lib/db";
import { deletePrefix, downloadObject, uploadObject } from "@/lib/storage";
import { Catalog } from "@/models/Catalog";
import { ProcessingJob } from "@/models/ProcessingJob";
import type { ProductLink } from "@/types/catalog";

const run = promisify(execFile);
const workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;

function maxAttempts() {
  return Math.max(1, Number(process.env.WORKER_MAX_ATTEMPTS || 3));
}

async function leaseJob() {
  await connectDb();
  const now = new Date();
  const lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
  return ProcessingJob.findOneAndUpdate(
    {
      attempts: { $lt: maxAttempts() },
      availableAt: { $lte: now },
      $or: [{ status: "queued" }, { status: "leased", lockedUntil: { $lt: now } }],
    },
    {
      $set: { status: "leased", lockedUntil, workerId },
      $inc: { attempts: 1 },
    },
    { sort: { availableAt: 1, createdAt: 1 }, returnDocument: "after" },
  );
}

async function pageCount(pdfPath: string) {
  const { stdout } = await run(process.env.PDFINFO_BIN || "pdfinfo", [pdfPath], {
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const match = stdout.match(/^Pages:\s+(\d+)/m);
  if (!match) throw new Error("The PDF page count could not be determined.");
  const count = Number(match[1]);
  if (!count || count > 1000) throw new Error("PDF page count is outside the supported range (1-1000 pages).");
  return count;
}

async function renderPage(pdfPath: string, page: number, workDir: string) {
  const prefix = join(workDir, `render-${String(page).padStart(4, "0")}`);
  await run(
    process.env.PDFTOPPM_BIN || "pdftoppm",
    ["-f", String(page), "-l", String(page), "-singlefile", "-jpeg", "-r", "220", "-jpegopt", "quality=90,progressive=y,optimize=y", pdfPath, prefix],
    { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
  );
  return `${prefix}.jpg`;
}

export async function processCatalog(catalogId: string) {
  await connectDb();
  const catalog = await Catalog.findById(catalogId);
  if (!catalog?.sourceKey) throw new Error("Catalog source PDF is missing.");

  const workDir = await mkdtemp(join(tmpdir(), "rk-catalog-"));
  const pdfPath = join(workDir, "source.pdf");
  const assetVersion = randomUUID();
  const assetPrefix = `catalogs/${catalogId}/assets/${assetVersion}/`;
  const generatedCover = !catalog.coverImageKey
    || catalog.coverImageKey.startsWith(`catalogs/${catalogId}/pages/`)
    || catalog.coverImageKey.startsWith(`catalogs/${catalogId}/assets/`);
  const existingLinks = new Map<number, ProductLink[]>(
    (catalog.pages || []).map((page: { page: number; productLinks?: ProductLink[] }) => [
      page.page,
      (page.productLinks || []).map((product) => ({
        sku: product.sku,
        label: product.label,
        href: product.href,
        x: product.x ?? undefined,
        y: product.y ?? undefined,
        width: product.width ?? undefined,
        height: product.height ?? undefined,
      })),
    ]),
  );
  let completed = false;

  try {
    await Catalog.findByIdAndUpdate(catalogId, {
      status: "processing",
      processingProgress: 2,
      processingMessage: "Downloading source PDF...",
      processingError: "",
    });
    await downloadObject(catalog.sourceKey, pdfPath);
    const file = await open(pdfPath, "r");
    const headerBuffer = Buffer.alloc(5);
    await file.read(headerBuffer, 0, 5, 0);
    await file.close();
    if (headerBuffer.toString("ascii") !== "%PDF-") throw new Error("The uploaded file is not a valid PDF document.");

    await Catalog.findByIdAndUpdate(catalogId, { processingProgress: 5, processingMessage: "Inspecting document..." });
    const count = await pageCount(pdfPath);
    const renderedPages: Array<{
      page: number;
      width: number;
      height: number;
      imageKey: string;
      thumbnailKey: string;
      mediumKey: string;
      largeKey: string;
      productLinks: ProductLink[];
    }> = [];

    for (let page = 1; page <= count; page += 1) {
      await Catalog.findByIdAndUpdate(catalogId, {
        processingProgress: Math.round(5 + ((page - 1) / count) * 90),
        processingMessage: `Optimizing page ${page} of ${count}...`,
      });

      const renderedPath = await renderPage(pdfPath, page, workDir);
      const input = sharp(renderedPath, { limitInputPixels: 120_000_000 }).rotate();
      const [thumbnailBuffer, mediumBuffer, largeBuffer] = await Promise.all([
        input.clone().resize({ width: 280, withoutEnlargement: true }).webp({ quality: 74, effort: 4, smartSubsample: true }).toBuffer(),
        input.clone().resize({ width: 1280, withoutEnlargement: true }).webp({ quality: 82, effort: 5, smartSubsample: true }).toBuffer(),
        input.clone().resize({ width: 2400, withoutEnlargement: true }).webp({ quality: 88, effort: 5, smartSubsample: true }).toBuffer(),
      ]);
      const metadata = await sharp(largeBuffer).metadata();
      const stem = String(page).padStart(4, "0");
      const thumbnailKey = `${assetPrefix}thumbnail/${stem}.webp`;
      const mediumKey = `${assetPrefix}medium/${stem}.webp`;
      const largeKey = `${assetPrefix}large/${stem}.webp`;

      await Promise.all([
        uploadObject(thumbnailKey, thumbnailBuffer, "image/webp"),
        uploadObject(mediumKey, mediumBuffer, "image/webp"),
        uploadObject(largeKey, largeBuffer, "image/webp"),
      ]);
      renderedPages.push({
        page,
        width: metadata.width || 2400,
        height: metadata.height || 3200,
        imageKey: largeKey,
        thumbnailKey,
        mediumKey,
        largeKey,
        productLinks: existingLinks.get(page) || [],
      });
      await unlink(renderedPath).catch(() => undefined);
    }

    const firstPage = renderedPages[0];
    await Catalog.findByIdAndUpdate(catalogId, {
      status: "ready",
      assetVersion,
      pages: renderedPages,
      pageCount: count,
      width: firstPage.width,
      height: firstPage.height,
      processingProgress: 100,
      processingMessage: "Catalog ready",
      processingError: "",
      ...(generatedCover ? { coverImageKey: firstPage.largeKey, coverContentType: "image/webp" } : {}),
    });
    completed = true;

    if (catalog.assetVersion) {
      await deletePrefix(`catalogs/${catalogId}/assets/${catalog.assetVersion}/`).catch((error) => console.error(`[worker:${workerId}] Old asset cleanup failed:`, error));
    } else {
      await Promise.allSettled([
        deletePrefix(`catalogs/${catalogId}/pages/`),
        deletePrefix(`catalogs/${catalogId}/thumbnails/`),
      ]);
    }
  } finally {
    if (!completed) await deletePrefix(assetPrefix).catch(() => undefined);
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function workOnce() {
  const job = await leaseJob();
  if (!job) return false;
  const heartbeat = setInterval(() => {
    void ProcessingJob.updateOne(
      { _id: job._id, status: "leased", workerId },
      { $set: { lockedUntil: new Date(Date.now() + 30 * 60 * 1000) } },
    ).catch((error) => console.error(`[worker:${workerId}] Lease heartbeat failed:`, error));
  }, 5 * 60 * 1000);
  try {
    await processCatalog(String(job.catalogId));
    await ProcessingJob.findByIdAndUpdate(job._id, {
      status: "completed",
      lockedUntil: null,
      lastError: "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown processing error";
    const finalAttempt = job.attempts >= maxAttempts();
    await ProcessingJob.findByIdAndUpdate(job._id, {
      status: finalAttempt ? "failed" : "queued",
      lockedUntil: null,
      workerId: null,
      lastError: message.slice(0, 2000),
      availableAt: new Date(Date.now() + Math.min(60_000, 5000 * 2 ** Math.max(0, job.attempts - 1))),
    });
    await Catalog.findByIdAndUpdate(job.catalogId, {
      status: finalAttempt ? "error" : "processing",
      processingMessage: finalAttempt ? "Processing failed" : "Processing will retry shortly...",
      processingError: message.slice(0, 1000),
    });
    console.error(`[worker:${workerId}] Catalog ${job.catalogId} failed:`, error);
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
