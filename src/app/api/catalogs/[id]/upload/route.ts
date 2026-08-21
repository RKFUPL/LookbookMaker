import { randomUUID } from "node:crypto";
import { isValidObjectId } from "mongoose";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { apiError, ApiError, readJson } from "@/lib/http";
import { signedUploadUrl } from "@/lib/storage";
import { uploadInitSchema } from "@/lib/validation";
import { Catalog } from "@/models/Catalog";

type Context = { params: Promise<{ id: string }> };
const coverTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request, context: Context) {
  try {
    await requireStaff();
    const input = uploadInitSchema.parse(await readJson(request));
    await connectDb();
    const id = (await context.params).id;
    if (!isValidObjectId(id)) throw new ApiError(404, "Catalog not found.");
    const catalog = await Catalog.findById(id).select("+pendingSourceKey +pendingCoverKey");
    if (!catalog) throw new ApiError(404, "Catalog not found.");
    if (catalog.status === "processing") throw new ApiError(409, "This catalog is currently being processed.");

    const config = getConfig();
    if (input.kind === "pdf") {
      if (input.contentType !== "application/pdf" || !input.filename.toLowerCase().endsWith(".pdf")) {
        throw new ApiError(415, "Choose a valid PDF file.", "INVALID_FILE_TYPE");
      }
      if (input.size > config.MAX_PDF_SIZE_MB * 1024 * 1024) {
        throw new ApiError(413, `PDFs may be up to ${config.MAX_PDF_SIZE_MB} MB.`, "FILE_TOO_LARGE");
      }
    } else {
      if (!coverTypes.has(input.contentType)) throw new ApiError(415, "Cover must be a JPEG, PNG, or WebP image.");
      if (input.size > config.MAX_COVER_SIZE_MB * 1024 * 1024) {
        throw new ApiError(413, `Cover images may be up to ${config.MAX_COVER_SIZE_MB} MB.`);
      }
    }

    const extension = input.kind === "pdf" ? "pdf" : input.contentType.split("/")[1].replace("jpeg", "jpg");
    const key = `catalogs/${id}/${input.kind === "pdf" ? "source" : "cover"}/${randomUUID()}.${extension}`;
    if (input.kind === "pdf") {
      Object.assign(catalog, {
        pendingSourceKey: key,
        pendingSourceSize: input.size,
        pendingSourceContentType: input.contentType,
        pendingSourceFilename: input.filename.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255),
        status: "uploading",
        processingProgress: 0,
        processingMessage: "Uploading PDF…",
        processingError: "",
      });
    } else {
      Object.assign(catalog, {
        pendingCoverKey: key,
        pendingCoverSize: input.size,
        pendingCoverContentType: input.contentType,
      });
    }
    await catalog.save();
    const uploadUrl = await signedUploadUrl(key, input.contentType, input.kind === "cover" ? "public, max-age=31536000, immutable" : undefined);
    return NextResponse.json({ uploadUrl, key, method: "PUT", headers: { "Content-Type": input.contentType } });
  } catch (error) { return apiError(error); }
}
