import { isValidObjectId } from "mongoose";
import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { apiError, ApiError, readJson } from "@/lib/http";
import { catalogUpdateSchema } from "@/lib/validation";
import { uniqueSlug } from "@/lib/slug";
import { serializeCatalog } from "@/lib/catalog-serializer";
import { deletePrefix } from "@/lib/storage";
import { Catalog } from "@/models/Catalog";
import { CatalogEvent } from "@/models/CatalogEvent";
import { ProcessingJob } from "@/models/ProcessingJob";
import { assertSafeRemoteUrl } from "@/lib/remote-source";

type Context = { params: Promise<{ id: string }> };

async function findCatalog(id: string) {
  if (!isValidObjectId(id)) throw new ApiError(404, "Catalog not found.", "NOT_FOUND");
  const catalog = await Catalog.findById(id);
  if (!catalog) throw new ApiError(404, "Catalog not found.", "NOT_FOUND");
  return catalog;
}

export async function GET(_: Request, context: Context) {
  try {
    await requireStaff();
    await connectDb();
    const catalog = await findCatalog((await context.params).id);
    return NextResponse.json({ catalog: await serializeCatalog(catalog, true) });
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request, context: Context) {
  try {
    const staff = await requireStaff();
    const input = catalogUpdateSchema.parse(await readJson(request));
    await connectDb();
    const catalog = await findCatalog((await context.params).id);
    if (input.title && input.title !== catalog.title) catalog.slug = await uniqueSlug(input.title, String(catalog._id));
    const sourceChanged = input.pdfUrl !== undefined && input.pdfUrl !== (catalog.sourcePdfUrl || catalog.sourceUrl || "");
    if (sourceChanged) {
      if (["downloading", "processing"].includes(catalog.status)) throw new ApiError(409, "Wait for current processing to finish before changing the PDF source.");
      if (!input.pdfUrl) throw new ApiError(400, "A PDF source URL is required.");
      try {
        await assertSafeRemoteUrl(input.pdfUrl);
      } catch {
        throw new ApiError(400, "Unable to import this PDF.", "INVALID_SOURCE_URL");
      }
    }
    const { collection, pdfUrl, status, ...details } = input;
    Object.assign(catalog, details, {
      ...(collection ? { collectionName: collection } : {}),
      ...(pdfUrl !== undefined ? { sourceUrl: undefined, sourcePdfUrl: pdfUrl, sourceType: "external_url" } : {}),
      ...(status ? { status } : {}),
      updatedBy: staff.userId,
    });
    if (sourceChanged) {
      catalog.sourceUrl = undefined;
      catalog.sourcePdfUrl = pdfUrl;
      catalog.sourceType = "external_url";
      catalog.status = "downloading";
      catalog.processingProgress = 1;
      catalog.processingMessage = "Downloading PDF...";
      catalog.processingError = "";
      catalog.failureCode = undefined;
      catalog.failureDetail = "";
    }
    await catalog.save();
    if (sourceChanged) {
      await ProcessingJob.deleteMany({ catalogId: catalog._id, status: { $in: ["queued", "failed"] } });
      await ProcessingJob.create({ catalogId: catalog._id, status: "queued", availableAt: new Date() });
    }
    return NextResponse.json({ catalog: await serializeCatalog(catalog) });
  } catch (error) { return apiError(error); }
}

export async function DELETE(_: Request, context: Context) {
  try {
    await requireStaff();
    await connectDb();
    const catalog = await findCatalog((await context.params).id);
    const id = String(catalog._id);
    if (["downloading", "processing"].includes(catalog.status)) throw new ApiError(409, "Wait for processing to finish before deleting this catalog.");
    await Promise.all([
      Catalog.deleteOne({ _id: catalog._id }),
      ProcessingJob.deleteMany({ catalogId: catalog._id }),
      CatalogEvent.deleteMany({ catalogId: catalog._id }),
    ]);
    await deletePrefix(`catalogs/${id}/`).catch((error) => console.error(`Unable to remove storage prefix for deleted catalog ${id}:`, error));
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
