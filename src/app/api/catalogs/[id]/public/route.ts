import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { apiError, ApiError } from "@/lib/http";
import { serializePublicCatalog } from "@/lib/catalog-serializer";
import { Catalog } from "@/models/Catalog";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDb();
    const slug = (await params).id.toLowerCase();
    const catalog = await Catalog.findOne({ slug, status: "published" });
    if (!catalog) throw new ApiError(404, "This catalog is unavailable.", "NOT_FOUND");
    const payload = await serializePublicCatalog(catalog, true);
    return NextResponse.json(
      { catalog: payload },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (error) { return apiError(error); }
}
