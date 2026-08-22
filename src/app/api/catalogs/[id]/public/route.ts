import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { apiError, ApiError } from "@/lib/http";
import { serializePublicCatalog } from "@/lib/catalog-serializer";
import { Catalog } from "@/models/Catalog";
import { normalizeCatalogSource } from "@/lib/catalog-source";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDb();
    const slug = (await params).id.toLowerCase();
    const catalog = await Catalog.findOne({ slug, status: "published" });
    if (!catalog) throw new ApiError(404, "This catalog is unavailable.", "NOT_FOUND");
    const source = await normalizeCatalogSource(catalog);
    const payload = await serializePublicCatalog(catalog);
    console.info("[RK CATALOG]", {
      slug: payload.slug,
      resolvedCatalogId: payload.id,
      sourcePdfUrlPresent: Boolean(source.sourcePdfUrl),
      pdfProxyUrl: `/api/catalogs/${payload.id}/pdf`,
    });
    return NextResponse.json(
      { catalog: payload },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) { return apiError(error); }
}
