import { isValidObjectId } from "mongoose";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { apiError, ApiError } from "@/lib/http";
import { serializeCatalog } from "@/lib/catalog-serializer";
import { Catalog } from "@/models/Catalog";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireStaff();
    await connectDb();
    const id = (await params).id;
    if (!isValidObjectId(id)) throw new ApiError(404, "Catalog not found.");
    const catalog = await Catalog.findById(id);
    if (!catalog) throw new ApiError(404, "Catalog not found.");
    if (!["ready", "published"].includes(catalog.status) || !catalog.pageCount || !catalog.pages.length) {
      throw new ApiError(409, "The catalog must finish processing before it can be published.");
    }
    catalog.status = "published";
    catalog.publishedAt = catalog.publishedAt || new Date();
    catalog.updatedBy = staff.userId;
    await catalog.save();
    return NextResponse.json({ catalog: await serializeCatalog(catalog) });
  } catch (error) { return apiError(error); }
}
