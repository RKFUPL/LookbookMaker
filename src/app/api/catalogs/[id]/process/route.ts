import { isValidObjectId } from "mongoose";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { apiError, ApiError } from "@/lib/http";
import { serializeCatalog } from "@/lib/catalog-serializer";
import { Catalog } from "@/models/Catalog";
import { normalizeCatalogSource } from "@/lib/catalog-source";
import { catalogHasPdf } from "@/lib/catalog-availability";

// Kept as a compatibility endpoint for older admin links. PDF rendering remains
// on demand, so processing only validates that the catalog has a usable source.
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireStaff();
    await connectDb();
    const id = (await params).id;
    if (!isValidObjectId(id)) throw new ApiError(404, "Catalog not found.");
    const catalog = await Catalog.findById(id);
    if (!catalog) throw new ApiError(404, "Catalog not found.");
    await normalizeCatalogSource(catalog);
    if (!catalogHasPdf(catalog)) throw new ApiError(409, "Attach a PDF before processing this catalog.");
    catalog.status = catalog.status === "published" ? "published" : "imported";
    catalog.processingProgress = 100;
    catalog.processingMessage = catalog.sourceType === "local" ? "Local PDF storage - pages load through the server." : "PDF source is ready.";
    catalog.failureCode = undefined;
    catalog.failureDetail = "";
    catalog.updatedBy = staff.userId;
    await catalog.save();
    return NextResponse.json({ catalog: await serializeCatalog(catalog) });
  } catch (error) { return apiError(error); }
}
