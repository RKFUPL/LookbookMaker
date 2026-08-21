import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, open, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { connectDb } from "@/lib/db";
import { deletePrefix, downloadObject, objectHead, StorageError, uploadObject } from "@/lib/storage";
import { downloadRemotePdf } from "@/lib/remote-source";
import { getConfig } from "@/lib/config";
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
  const catalog = await Catalog.findById(catalogId).select("+pendingProductLinks");
  const sourceUrl = catalog?.sourceUrl || catalog?.sourcePdfUrl;
  if (!catalog?.sourceKey && !sourceUrl) throw new Error("Catalog source PDF URL is missing.");

  const workDir = await mkdtemp(join(tmpdir(), "rk-catalog-"));
  const pdfPath = join(workDir, "source.pdf");
  const assetVersion = randomUUID();
  const assetPrefix = `catalogs/${catalogId}/assets/${assetVersion}/`;
  const shouldPublishAfterProcessing = catalog.status === "published" || Boolean(catalog.publishedAt);
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
  for (const page of catalog.pendingProductLinks || []) {
    if (!existingLinks.has(page.page)) {
      existingLinks.set(page.page, (page.productLinks || []).map((product: ProductLink) => ({
        sku: product.sku,
        label: product.label,
        href: product.href,
        x: product.x ?? undefined,
        y: product.y ?? undefined,
        width: product.width ?? undefined,
        height: product.height ?? undefined,
      })));
    }
  }
  let completed = false;

  try {
    await Catalog.findByIdAndUpdate(catalogId, {
      status: "processing",
      processingProgress: 2,
      processingMessage: "Downloading source PDF...",
      processingError: "",
    });
    const externalSource = Boolean(sourceUrl);
    const previousSourceKey = catalog.sourceKey;
    const sourceKey = externalSource ? undefined : catalog.sourceKey;
    let sourceDetails: { size: number; contentType: string; finalUrl: string; etag?: string } | undefined;
    if (sourceUrl) {
      sourceDetails = await downloadRemotePdf(sourceUrl, pdfPath, getConfig().MAX_PDF_SIZE_MB * 1024 * 1024);
    } else if (sourceKey) {
      await downloadObject(sourceKey, pdfPath);
    } else {
      throw new Error("Catalog source PDF URL is missing.");
    }
    const file = await open(pdfPath, "r");
    const headerBuffer = Buffer.alloc(5);
    await file.read(headerBuffer, 0, 5, 0);
    await file.close();
    if (headerBuffer.toString("ascii") !== "%PDF-") throw new Error("The uploaded file is not a valid PDF document.");
    if (sourceDetails && sourceUrl) {
      const pathName = new URL(sourceUrl).pathname.split("/").pop() || "catalog.pdf";
      const originalFilename = decodeURIComponent(pathName).replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120) || "catalog.pdf";
      await Catalog.findByIdAndUpdate(catalogId, {
        $unset: { sourceKey: "", sourceEtag: "" },
        $set: {
          sourcePdfUrl: sourceUrl,
          sourceType: "external_url",
          sourceSize: sourceDetails.size,
          sourceContentType: "application/pdf",
          originalFilename: originalFilename.toLowerCase().endsWith(".pdf") ? originalFilename : `${originalFilename}.pdf`,
        },
      });
    }

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
    if (!firstPage || renderedPages.length !== count) throw new Error("The generated page count does not match the PDF.");
    const verificationKeys = [firstPage.largeKey, renderedPages[renderedPages.length - 1].largeKey, ...renderedPages.map((page) => page.thumbnailKey)];
    const verified = await Promise.all(verificationKeys.map((key) => objectHead(key)));
    if (verified.some((head) => Number(head.ContentLength) <= 0 || !String(head.ContentType).toLowerCase().includes("image/webp"))) {
      throw new StorageError("Generated R2 assets could not be verified.");
    }
    const finalUpdate: Record<string, unknown> = {
      status: shouldPublishAfterProcessing ? "published" : "ready",
      assetVersion,
      assetBasePrefix: assetPrefix,
      pages: renderedPages,
      pageCount: count,
      width: firstPage.width,
      height: firstPage.height,
      processingProgress: 100,
      processingMessage: "Catalog ready",
      processingError: "",
      pendingProductLinks: [],
      ...(generatedCover ? { coverImageKey: firstPage.largeKey, coverContentType: "image/webp" } : {}),
    };
    if (externalSource) {
      finalUpdate.sourceType = "external_url";
      finalUpdate.sourcePdfUrl = sourceUrl;
    } else if (sourceKey) {
      finalUpdate.sourceType = "uploaded";
    }
    await Catalog.findByIdAndUpdate(catalogId, finalUpdate);
    completed = true;

    if (catalog.assetVersion) {
      await deletePrefix(`catalogs/${catalogId}/assets/${catalog.assetVersion}/`).catch((error) => console.error(`[worker:${workerId}] Old asset cleanup failed:`, error));
    } else {
      await Promise.allSettled([
        deletePrefix(`catalogs/${catalogId}/pages/`),
        deletePrefix(`catalogs/${catalogId}/thumbnails/`),
      ]);
    }
    if (externalSource && previousSourceKey) {
      await deletePrefix(`catalogs/${catalogId}/source/`).catch((error) => console.error(`[worker:${workerId}] External source cleanup failed:`, error));
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
    const failureStatus = error instanceof StorageError ? "storage_failed" : "processing_failed";
    await Catalog.findByIdAndUpdate(job.catalogId, {
      status: finalAttempt ? failureStatus : "processing",
      processingMessage: finalAttempt ? (failureStatus === "storage_failed" ? "Storage failed" : "Processing failed") : "Processing will retry shortly...",
      processingError: message.slice(0, 1000),
    });
    console.error(`[worker:${workerId}] Catalog ${job.catalogId} failed:`, error);
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
