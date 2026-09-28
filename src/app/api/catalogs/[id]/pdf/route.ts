import { isValidObjectId } from "mongoose";
import { NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { Catalog } from "@/models/Catalog";
import { assertSafeRemoteUrl } from "@/lib/remote-source";
import { normalizeCatalogSource } from "@/lib/catalog-source";
import { preparePdfResponse } from "@/lib/pdf-response";
import { downloadWorkDrivePdf } from "@/lib/workdrive";
import { canAccessCatalogPdf } from "@/lib/catalog-availability";
import { localPdfResponse } from "@/lib/local-pdf-storage";
import { ApiError } from "@/lib/http";

const MAX_REDIRECTS = 5;
const FORWARDED_REQUEST_HEADERS = ["range", "if-range", "if-none-match", "if-modified-since"] as const;
const FORWARDED_RESPONSE_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"] as const;

function errorResponse(status: number, message = "Unable to load the source PDF.", code?: string) {
  return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status, headers: { "Cache-Control": "no-store" } });
}

async function workDriveErrorResponse(response: Response) {
  const body = await response.json().catch(() => null) as { providerCode?: string; providerMessage?: string } | null;
  const detail = body?.providerMessage || "WorkDrive returned no diagnostic response body.";
  const providerCode = body?.providerCode ? ` [${body.providerCode}]` : "";
  return errorResponse(response.status, `WorkDrive PDF download failed (HTTP ${response.status}): ${detail}${providerCode}`, "WORKDRIVE_DOWNLOAD_FAILED");
}

async function fetchSource(url: string, request: Request) {
  let currentUrl = await assertSafeRemoteUrl(url);
  const headers = new Headers({ Accept: "application/pdf, application/octet-stream;q=0.9" });
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetch(currentUrl, { headers, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30_000) });
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

async function servePdf(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDb();
    const id = (await params).id;
    if (!isValidObjectId(id)) return errorResponse(404, "Catalog not found.");
    // Read the complete legacy document so older source field names can be normalized.
    const catalog = await Catalog.findById(id);
    if (!catalog) return errorResponse(404, "Catalog not found.");
    const source = await normalizeCatalogSource(catalog);
    if (catalog.sourceType === "local" && !catalog.storageKey) return errorResponse(422, "Catalog has no local PDF configured.", "SOURCE_MISSING");
    if (catalog.sourceType !== "workdrive" && catalog.sourceType !== "local" && !source.sourcePdfUrl) return errorResponse(422, "Catalog has no source PDF configured.", "SOURCE_MISSING");
    if (catalog.sourceType === "workdrive" && !catalog.workdriveFileId) return errorResponse(422, "Catalog has no WorkDrive file configured.", "SOURCE_MISSING");

    // Published readers are public. Staff preview may proxy imported/draft files.
    const hasStaffSession = catalog.status === "published" ? false : Boolean(await getStaffSession());
    if (!canAccessCatalogPdf(String(catalog.status), hasStaffSession)) return errorResponse(404, "Catalog not found.");

    if (catalog.sourceType === "local") {
      const download = new URL(request.url).searchParams.get("download") === "1";
      return await localPdfResponse(catalog.storageKey!, request, download ? `${catalog.slug}.pdf` : undefined);
    }

    let upstream: Response;
    try {
      upstream = catalog.sourceType === "workdrive"
        ? await downloadWorkDrivePdf(catalog.workdriveFileId!, request)
        : await fetchSource(source.sourcePdfUrl, request);
    } catch (error) {
      const reason = error instanceof Error ? error.name : "UnknownError";
      console.error(`Source PDF proxy fetch failed (${reason}).`);
      return errorResponse(502);
    }
    if (!upstream.ok && upstream.status !== 206 && upstream.status !== 304) {
      if (catalog.sourceType === "workdrive") return workDriveErrorResponse(upstream);
      return errorResponse(upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502);
    }
    const prepared = upstream.status === 304 ? { valid: true, body: null } : await preparePdfResponse(upstream);
    if (!prepared.valid) {
      console.error(
        `Source PDF proxy received a non-PDF response: status=${upstream.status}, content-type=${upstream.headers.get("content-type") || "missing"}, content-range=${upstream.headers.get("content-range") || "missing"}.`,
      );
      return errorResponse(502, "The configured source did not return a valid PDF.", "INVALID_PDF_SOURCE");
    }

    const responseHeaders = new Headers();
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    // fetch() transparently decodes compressed upstream bodies. Do not leave
    // a compressed Content-Length attached to the decoded response.
    if (upstream.headers.has("content-encoding")) responseHeaders.delete("content-length");
    if (!responseHeaders.has("content-type")) responseHeaders.set("content-type", "application/pdf");
    if (new URL(request.url).searchParams.get("download") === "1") {
      responseHeaders.set("content-disposition", `attachment; filename="${catalog.slug}.pdf"`);
    }
    responseHeaders.set("cache-control", "public, max-age=300, s-maxage=300, stale-while-revalidate=86400");
    responseHeaders.set("vary", "Range");
    return new Response(prepared.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error.status, error.message, error.code);
    console.error("Source PDF proxy error:", error);
    return errorResponse(502);
  }
}

export const GET = servePdf;
export const HEAD = servePdf;
