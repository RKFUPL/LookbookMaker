import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { apiError, ApiError } from "@/lib/http";
import { Catalog } from "@/models/Catalog";
import { CatalogEvent } from "@/models/CatalogEvent";
import { normalizeCatalogSource } from "@/lib/catalog-source";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDb();
    const slug = (await params).id.toLowerCase();
    const catalog = await Catalog.findOne({ slug, status: "published", allowDownload: true });
    if (!catalog) throw new ApiError(404, "Download is unavailable.");
    const source = await normalizeCatalogSource(catalog);
    if (!source.sourcePdfUrl) throw new ApiError(404, "Download is unavailable.");
    await CatalogEvent.create({
      catalogId: catalog._id,
      type: "download",
      referrer: request.headers.get("referer")?.slice(0, 500),
      userAgent: request.headers.get("user-agent")?.slice(0, 500),
    }).catch(() => undefined);
    return NextResponse.redirect(new URL(`/api/catalogs/${catalog._id}/pdf?download=1`, request.url), 307);
  } catch (error) { return apiError(error); }
}
