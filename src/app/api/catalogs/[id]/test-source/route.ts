import { isValidObjectId } from "mongoose";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { apiError, ApiError, readJson } from "@/lib/http";
import { assertSafeRemoteUrl } from "@/lib/remote-source";
import { normalizeCatalogSource } from "@/lib/catalog-source";
import { Catalog } from "@/models/Catalog";

const MAX_REDIRECTS = 5;

async function probePdf(url: string) {
  let currentUrl = await assertSafeRemoteUrl(url);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetch(currentUrl, {
      headers: { Accept: "application/pdf, application/octet-stream;q=0.9", Range: "bytes=0-4" },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) throw new Error("The PDF source redirected too many times.");
      currentUrl = await assertSafeRemoteUrl(new URL(location, currentUrl).toString());
      continue;
    }
    if (!response.ok && response.status !== 206) throw new Error("PDF source unavailable.");
    const contentLength = Number(response.headers.get("content-length") || 0);
    const contentRange = response.headers.get("content-range") || "";
    const size = contentRange.match(/\/([0-9]+)$/)?.[1] || (contentLength > 0 ? String(contentLength) : "0");
    const contentType = response.headers.get("content-type") || "";
    let pdfHeader = false;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        const chunk = await reader.read();
        pdfHeader = new TextDecoder().decode(chunk.value?.slice(0, 5)).startsWith("%PDF-");
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    }
    const looksLikePdf = /application\/(pdf|octet-stream)|binary/i.test(contentType) || /\.pdf(?:$|[?#])/i.test(currentUrl) || pdfHeader;
    if (!looksLikePdf || Number(size) <= 0) throw new Error("PDF source unavailable.");
    return { contentType: contentType || "application/pdf", size: Number(size) };
  }
  throw new Error("The PDF source redirected too many times.");
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireStaff();
    await connectDb();
    const id = (await params).id;
    if (!isValidObjectId(id)) throw new ApiError(404, "Catalog not found.", "NOT_FOUND");
    const catalog = await Catalog.findById(id);
    if (!catalog) throw new ApiError(404, "Catalog not found.", "NOT_FOUND");
    const storedSource = await normalizeCatalogSource(catalog);
    const body = await readJson(request) as { pdfUrl?: unknown };
    const sourcePdfUrl = typeof body.pdfUrl === "string" && body.pdfUrl.trim() ? body.pdfUrl.trim() : storedSource.sourcePdfUrl;
    if (!sourcePdfUrl) throw new ApiError(422, "Catalog has no source PDF URL configured.", "SOURCE_MISSING");
    try {
      const safeUrl = await assertSafeRemoteUrl(sourcePdfUrl);
      const result = await probePdf(safeUrl);
      return NextResponse.json({ valid: true, message: "PDF source valid", ...result });
    } catch {
      return NextResponse.json({ valid: false, error: "PDF source unavailable" }, { status: 422 });
    }
  } catch (error) {
    return apiError(error);
  }
}
