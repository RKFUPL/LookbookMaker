import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { apiError, ApiError } from "@/lib/http";
import { privateDownloadUrl } from "@/lib/storage";
import { Catalog } from "@/models/Catalog";
import { CatalogEvent } from "@/models/CatalogEvent";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDb();
    const slug = (await params).id.toLowerCase();
    const catalog = await Catalog.findOne({ slug, status: "published", allowDownload: true });
    if (!catalog?.sourceKey) throw new ApiError(404, "Download is unavailable.");
    await CatalogEvent.create({
      catalogId: catalog._id,
      type: "download",
      referrer: request.headers.get("referer")?.slice(0, 500),
      userAgent: request.headers.get("user-agent")?.slice(0, 500),
    }).catch(() => undefined);
    const url = await privateDownloadUrl(catalog.sourceKey, catalog.originalFilename || `${catalog.slug}.pdf`);
    return NextResponse.redirect(url, 307);
  } catch (error) { return apiError(error); }
}
