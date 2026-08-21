import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { Catalog } from "@/models/Catalog";
import { connectDb } from "@/lib/db";
import { getStaffSession, requireStaff } from "@/lib/auth";
import { apiError, ApiError } from "@/lib/http";
import { isLocalStorage, localObjectPath, verifyLocalDownloadToken } from "@/lib/storage";

function contentType(key: string) {
  const extension = key.split(".").pop()?.toLowerCase();
  return extension === "pdf" ? "application/pdf" : extension === "png" ? "image/png" : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : "image/webp";
}

export async function GET(request: Request) {
  try {
    if (!isLocalStorage()) throw new ApiError(410, "This deployment serves assets directly from object storage.", "DIRECT_STORAGE_ASSET");
    const url = new URL(request.url);
    const key = url.searchParams.get("key") || "";
    const isSource = key.includes("/source/");
    const signedDownload = url.searchParams.get("download") === "1" && verifyLocalDownloadToken(key, url.searchParams.get("expires") || "", url.searchParams.get("token") || "");
    if (isSource && !signedDownload) await requireStaff();
    if (!isSource) {
      await connectDb();
      const catalog = await Catalog.findOne({
        $or: [
          { coverImageKey: key },
          { "pages.imageKey": key },
          { "pages.thumbnailKey": key },
          { "pages.mediumKey": key },
          { "pages.largeKey": key },
        ],
      }).select("status");
      if (!catalog) throw new ApiError(404, "Object not found.", "NOT_FOUND");
      if (catalog.status !== "published" && !await getStaffSession()) await requireStaff();
    }
    const path = localObjectPath(key);
    const details = await stat(path);
    const headers = new Headers({ "Content-Type": contentType(key), "Content-Length": String(details.size), "Cache-Control": isSource ? "private, no-store" : "public, max-age=31536000, immutable" });
    if (url.searchParams.get("download") === "1") headers.set("Content-Disposition", `attachment; filename="${(url.searchParams.get("filename") || "catalog.pdf").replace(/[^a-zA-Z0-9._-]/g, "-")}"`);
    return new NextResponse(Readable.toWeb(createReadStream(path)) as unknown as BodyInit, { headers });
  } catch (error) { return apiError(error); }
}
