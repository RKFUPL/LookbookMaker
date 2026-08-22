import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { apiError, ApiError, readJson } from "@/lib/http";
import { catalogCreateSchema } from "@/lib/validation";
import { uniqueSlug } from "@/lib/slug";
import { serializeCatalog } from "@/lib/catalog-serializer";
import { Catalog } from "@/models/Catalog";
import { ProcessingJob } from "@/models/ProcessingJob";
import { assertSafeRemoteUrl } from "@/lib/remote-source";

export async function GET(request: Request) {
  try {
    await requireStaff();
    await connectDb();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const query = searchParams.get("q")?.trim();
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") || 20)));
    const filter: Record<string, unknown> = {};
    if (status && ["draft", "downloading", "processing", "ready", "published", "failed", "archived"].includes(status)) {
      filter.status = status === "failed"
        ? { $in: ["failed", "error", "processing_failed", "storage_failed"] }
        : status === "downloading" ? { $in: ["downloading", "uploading"] } : status;
    }
    if (query) filter.$text = { $search: query.slice(0, 100) };

    const [catalogs, total, counts] = await Promise.all([
      Catalog.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit),
      Catalog.countDocuments(filter),
      Catalog.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);
    const normalizedCounts = Object.fromEntries(counts.map((item) => [item._id, item.count])) as Record<string, number>;
    normalizedCounts.downloading = (normalizedCounts.downloading || 0) + (normalizedCounts.uploading || 0);
    normalizedCounts.failed = (normalizedCounts.failed || 0) + (normalizedCounts.error || 0)
      + (normalizedCounts.processing_failed || 0) + (normalizedCounts.storage_failed || 0);
    delete normalizedCounts.uploading;
    delete normalizedCounts.error;
    delete normalizedCounts.processing_failed;
    delete normalizedCounts.storage_failed;
    return NextResponse.json({
      catalogs: await Promise.all(catalogs.map((catalog) => serializeCatalog(catalog))),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      counts: normalizedCounts,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const staff = await requireStaff();
    const input = catalogCreateSchema.parse(await readJson(request));
    try {
      await assertSafeRemoteUrl(input.pdfUrl);
    } catch {
      throw new ApiError(400, "Unable to import this PDF.", "INVALID_SOURCE_URL");
    }
    await connectDb();
    const slug = await uniqueSlug(input.title);
    const { collection, pdfUrl, ...details } = input;
    const catalog = await Catalog.create({
      ...details,
      collectionName: collection,
      sourcePdfUrl: pdfUrl,
      sourceType: "external_url",
      slug,
      status: "downloading",
      processingProgress: 1,
      processingMessage: "Downloading PDF...",
      createdBy: staff.userId,
      updatedBy: staff.userId,
    });
    try {
      await ProcessingJob.create({ catalogId: catalog._id, status: "queued", availableAt: new Date() });
    } catch (error) {
      await Catalog.deleteOne({ _id: catalog._id }).catch(() => undefined);
      throw error;
    }
    return NextResponse.json({ catalog: await serializeCatalog(catalog) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
