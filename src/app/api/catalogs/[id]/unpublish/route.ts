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
    if (catalog.status !== "published") throw new ApiError(409, "This catalog is not published.");
    catalog.status = "imported";
    catalog.updatedBy = staff.userId;
    await catalog.save();
    return NextResponse.json({ catalog: await serializeCatalog(catalog) });
  } catch (error) { return apiError(error); }
}
