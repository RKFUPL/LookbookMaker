import { isValidObjectId } from "mongoose";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { apiError, ApiError } from "@/lib/http";
import { serializeCatalog } from "@/lib/catalog-serializer";
import { Catalog } from "@/models/Catalog";
import { normalizeCatalogSource } from "@/lib/catalog-source";

// Kept as a compatibility endpoint for older admin links. External PDF mode
// intentionally performs no server-side rendering or permanent file writes.
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireStaff();
    await connectDb();
    const id = (await params).id;
    if (!isValidObjectId(id)) throw new ApiError(404, "Catalog not found.");
    const catalog = await Catalog.findById(id);
    if (!catalog) throw new ApiError(404, "Catalog not found.");
    const source = await normalizeCatalogSource(catalog);
    if (!source.sourcePdfUrl) throw new ApiError(409, "A hosted PDF URL is required.");
    catalog.status = catalog.status === "published" ? "published" : "imported";
    catalog.processingProgress = 100;
    catalog.processingMessage = "External PDF mode — pages load in the browser.";
    catalog.failureCode = undefined;
    catalog.failureDetail = "";
    catalog.updatedBy = staff.userId;
    await catalog.save();
    return NextResponse.json({ catalog: await serializeCatalog(catalog) });
  } catch (error) { return apiError(error); }
}
