import { isValidObjectId } from "mongoose";
import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { apiError, ApiError, readJson } from "@/lib/http";
import { catalogUpdateSchema } from "@/lib/validation";
import { uniqueSlug } from "@/lib/slug";
import { serializeCatalog } from "@/lib/catalog-serializer";
import { Catalog } from "@/models/Catalog";
import { CatalogEvent } from "@/models/CatalogEvent";
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
    return NextResponse.json({ catalog: await serializeCatalog(catalog) });
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request, context: Context) {
  try {
    const staff = await requireStaff();
    const input = catalogUpdateSchema.parse(await readJson(request));
    await connectDb();
    const catalog = await findCatalog((await context.params).id);
    if (input.title && input.title !== catalog.title) catalog.slug = await uniqueSlug(input.title, String(catalog._id));
    const sourceChanged = input.pdfUrl !== undefined && input.pdfUrl !== (catalog.sourcePdfUrl || "");
    if (sourceChanged) {
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
      ...(pdfUrl !== undefined ? { sourcePdfUrl: pdfUrl, sourceType: "external_url" } : {}),
      ...(status ? { status } : {}),
      updatedBy: staff.userId,
    });
    if (sourceChanged) {
      catalog.sourcePdfUrl = pdfUrl;
      catalog.sourceType = "external_url";
      catalog.status = "imported";
      catalog.processingProgress = 100;
      catalog.processingMessage = "External PDF mode — pages load in the browser.";
      catalog.processingError = "";
      catalog.failureCode = undefined;
      catalog.failureDetail = "";
    }
    await catalog.save();
    return NextResponse.json({ catalog: await serializeCatalog(catalog) });
  } catch (error) { return apiError(error); }
}

export async function DELETE(_: Request, context: Context) {
  try {
    await requireStaff();
    await connectDb();
    const catalog = await findCatalog((await context.params).id);
    await Promise.all([
      Catalog.deleteOne({ _id: catalog._id }),
      CatalogEvent.deleteMany({ catalogId: catalog._id }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
