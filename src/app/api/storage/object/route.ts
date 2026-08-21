import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { Catalog } from "@/models/Catalog";
import { connectDb } from "@/lib/db";
import { getStaffSession, requireStaff } from "@/lib/auth";
import { apiError, ApiError } from "@/lib/http";
import { getPublicAssetUrl, isLocalStorage, localObjectPath, privateDownloadUrl, privateObjectUrl, verifyLocalDownloadToken } from "@/lib/storage";

function contentType(key: string) {
  const extension = key.split(".").pop()?.toLowerCase();
  return extension === "pdf" ? "application/pdf" : extension === "png" ? "image/png" : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : "image/webp";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get("key") || "";
    if (!key) throw new ApiError(400, "Object key is required.", "INVALID_OBJECT_KEY");
    const isSource = key.includes("/source/");

    if (!isLocalStorage()) {
      if (isSource) {
        await requireStaff();
        const target = url.searchParams.get("download") === "1"
          ? await privateDownloadUrl(key, url.searchParams.get("filename") || "catalog.pdf")
          : await privateObjectUrl(key);
        return NextResponse.redirect(new URL(target, request.url), 307);
      }
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
      return NextResponse.redirect(await getPublicAssetUrl(key), 307);
    }

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
