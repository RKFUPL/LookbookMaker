import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { Catalog } from "@/models/Catalog";
import { connectDb } from "@/lib/db";
import { getStaffSession, requireStaff } from "@/lib/auth";
import { apiError, ApiError } from "@/lib/http";
import { localObjectPath, StorageError, verifyLocalDownloadToken } from "@/lib/storage";

export const runtime = "nodejs";

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
    const signedDownload = url.searchParams.get("download") === "1"
      && verifyLocalDownloadToken(key, url.searchParams.get("expires") || "", url.searchParams.get("token") || "");

    let catalog: InstanceType<typeof Catalog> | null = null;
    if (isSource) {
      if (!signedDownload) await requireStaff();
    } else {
      await connectDb();
      catalog = await Catalog.findOne({
        $or: [
          { coverImageKey: key },
          { "pages.imageKey": key },
          { "pages.thumbnailKey": key },
          { "pages.mediumKey": key },
          { "pages.largeKey": key },
        ],
      }).select("status");
      if (!catalog) throw new ApiError(404, "Catalog asset not found.", "NOT_FOUND");
      if (catalog.status !== "published" && !await getStaffSession()) await requireStaff();
    }

    const path = localObjectPath(key);
    let details;
    try {
      details = await stat(path);
      if (!details.isFile() || details.size <= 0) throw Object.assign(new Error("Object is empty."), { code: "ENOENT" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (catalog) {
        await Catalog.updateOne({ _id: catalog._id }, {
          $set: {
            status: "failed",
            failureCode: "storage_missing",
            failureDetail: `Missing persistent asset: ${key}`.slice(0, 2000),
            processingError: "Processed catalog files are missing from persistent storage.",
            processingMessage: "Catalog storage is missing",
          },
        }).catch(() => undefined);
      }
      throw new ApiError(404, "Catalog asset is missing. Reprocess this catalog to restore it.", "STORAGE_MISSING");
    }

    const headers = new Headers({
      "Content-Type": contentType(key),
      "Content-Length": String(details.size),
      "Cache-Control": isSource ? "private, no-store" : "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    if (url.searchParams.get("download") === "1") {
      const filename = (url.searchParams.get("filename") || "catalog.pdf").replace(/[^a-zA-Z0-9._-]/g, "-");
      headers.set("Content-Disposition", `attachment; filename="${filename}"`);
    }
    return new NextResponse(Readable.toWeb(createReadStream(path)) as unknown as BodyInit, { headers });
  } catch (error) {
    if (error instanceof StorageError && error.message === "Invalid object key.") {
      return apiError(new ApiError(400, "Invalid object key.", "INVALID_OBJECT_KEY"));
    }
    return apiError(error);
  }
}
