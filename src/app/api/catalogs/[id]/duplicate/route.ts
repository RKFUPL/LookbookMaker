import { isValidObjectId } from "mongoose";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { apiError, ApiError } from "@/lib/http";
import { uniqueSlug } from "@/lib/slug";
import { serializeCatalog } from "@/lib/catalog-serializer";
import { Catalog } from "@/models/Catalog";
import { normalizeCatalogSource } from "@/lib/catalog-source";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireStaff();
    await connectDb();
    const id = (await params).id;
    if (!isValidObjectId(id)) throw new ApiError(404, "Catalog not found.");
    const source = await Catalog.findById(id);
    if (!source) throw new ApiError(404, "Catalog not found.");
    const resolvedSource = await normalizeCatalogSource(source);
    const duplicate = await Catalog.create({
      title: `${source.title} — Copy`,
      slug: await uniqueSlug(`${source.title} copy`),
      collectionName: source.collectionName,
      season: source.season,
      description: source.description,
      sourcePdfUrl: resolvedSource.sourcePdfUrl,
      sourceType: "external_url",
      status: source.status === "published" ? "imported" : source.status,
      pageCount: source.pageCount || 0,
      width: source.width || 0,
      height: source.height || 0,
      allowDownload: source.allowDownload,
      showBackButton: source.showBackButton,
      createdBy: staff.userId,
      updatedBy: staff.userId,
    });
    return NextResponse.json({ catalog: await serializeCatalog(duplicate) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
