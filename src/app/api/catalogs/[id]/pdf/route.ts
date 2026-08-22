import { isValidObjectId } from "mongoose";
import { NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { Catalog } from "@/models/Catalog";
import { assertSafeRemoteUrl } from "@/lib/remote-source";
import { normalizeCatalogSource } from "@/lib/catalog-source";

const MAX_REDIRECTS = 5;
const FORWARDED_REQUEST_HEADERS = ["range", "if-range", "if-none-match", "if-modified-since"] as const;
const FORWARDED_RESPONSE_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"] as const;

function errorResponse(status: number, message = "Unable to load the source PDF.", code?: string) {
  return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status, headers: { "Cache-Control": "no-store" } });
}

async function fetchSource(url: string, request: Request) {
  let currentUrl = await assertSafeRemoteUrl(url);
  const headers = new Headers({ Accept: "application/pdf, application/octet-stream;q=0.9" });
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetch(currentUrl, { headers, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(120_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) throw new Error("The PDF source redirected too many times.");
      currentUrl = await assertSafeRemoteUrl(new URL(location, currentUrl).toString());
      continue;
    }
    return response;
  }
  throw new Error("The PDF source redirected too many times.");
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDb();
    const id = (await params).id;
    if (!isValidObjectId(id)) return errorResponse(404, "Catalog not found.");
    // Read the complete legacy document so older source field names can be normalized.
    const catalog = await Catalog.findById(id);
    if (!catalog) return errorResponse(404, "Catalog not found.");
    const source = await normalizeCatalogSource(catalog);
    if (!source.sourcePdfUrl) return errorResponse(422, "Catalog has no source PDF URL configured.", "SOURCE_MISSING");

    // Published readers are public. Staff preview may proxy imported/draft files.
    if (catalog.status !== "published" && !(await getStaffSession())) return errorResponse(404, "Catalog not found.");

    let upstream: Response;
    try {
      upstream = await fetchSource(source.sourcePdfUrl, request);
    } catch (error) {
      console.error("Source PDF proxy fetch failed:", error);
      return errorResponse(502);
    }
    if (!upstream.ok && upstream.status !== 206 && upstream.status !== 304) {
      return errorResponse(upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502);
    }

    const responseHeaders = new Headers();
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    if (!responseHeaders.has("content-type")) responseHeaders.set("content-type", "application/pdf");
    if (new URL(request.url).searchParams.get("download") === "1") {
      responseHeaders.set("content-disposition", `attachment; filename="${catalog.slug}.pdf"`);
    }
    responseHeaders.set("cache-control", "public, max-age=300, s-maxage=300, stale-while-revalidate=86400");
    responseHeaders.set("vary", "Range");
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    console.error("Source PDF proxy error:", error);
    return errorResponse(502);
  }
}
