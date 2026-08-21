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
    if (input.title && input.title !== catalog.title) catalog.slug = await uniqueSlug(`${input.title} ${input.season || catalog.season}`, String(catalog._id));
    const sourceChanged = input.sourceUrl !== undefined && input.sourceUrl !== (catalog.sourceUrl || "");
    if (sourceChanged) {
      if (catalog.status === "processing") throw new ApiError(409, "Wait for current processing to finish before changing the PDF source.");
      if (!input.sourceUrl) throw new ApiError(400, "A PDF source URL is required.");
      try {
        await assertSafeRemoteUrl(input.sourceUrl);
      } catch (reason) {
        throw new ApiError(400, reason instanceof Error ? reason.message : "The PDF source URL is not allowed.", "INVALID_SOURCE_URL");
      }
    }
    const { collection, sourceUrl, status, ...details } = input;
    Object.assign(catalog, details, {
      ...(collection ? { collectionName: collection } : {}),
      ...(sourceUrl !== undefined ? { sourceUrl } : {}),
      ...(status ? { status } : {}),
      updatedBy: staff.userId,
    });
    if (sourceChanged) {
      catalog.sourceKey = undefined;
      catalog.sourceSize = undefined;
      catalog.sourceEtag = undefined;
      catalog.sourceContentType = undefined;
      catalog.originalFilename = undefined;
      catalog.pages = [];
      catalog.pageCount = 0;
      catalog.width = 0;
      catalog.height = 0;
      catalog.assetVersion = undefined;
      catalog.status = "processing";
      catalog.processingProgress = 1;
      catalog.processingMessage = "Queued to fetch the source PDF...";
      catalog.processingError = "";
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
    if (catalog.status === "processing") throw new ApiError(409, "Wait for processing to finish before deleting this catalog.");
    await Promise.all([
      Catalog.deleteOne({ _id: catalog._id }),
      ProcessingJob.deleteMany({ catalogId: catalog._id }),
      CatalogEvent.deleteMany({ catalogId: catalog._id }),
    ]);
    await deletePrefix(`catalogs/${id}/`).catch((error) => console.error(`Unable to remove storage prefix for deleted catalog ${id}:`, error));
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
