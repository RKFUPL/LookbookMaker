import { isValidObjectId } from "mongoose";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { apiError, ApiError, readJson } from "@/lib/http";
import { objectHead, readObjectPrefix } from "@/lib/storage";
import { Catalog } from "@/models/Catalog";
import { ProcessingJob } from "@/models/ProcessingJob";

type Context = { params: Promise<{ id: string }> };
const schema = z.object({ kind: z.enum(["pdf", "cover"]), key: z.string().min(10).max(500) });

function isImageHeader(buffer: Buffer, type: string) {
  if (type === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (type === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

export async function POST(request: Request, context: Context) {
  try {
    const staff = await requireStaff();
    const input = schema.parse(await readJson(request));
    await connectDb();
    const id = (await context.params).id;
    if (!isValidObjectId(id)) throw new ApiError(404, "Catalog not found.");
    const catalog = await Catalog.findById(id).select("+pendingSourceKey +pendingSourceSize +pendingSourceContentType +pendingSourceFilename +pendingCoverKey +pendingCoverSize +pendingCoverContentType");
    if (!catalog) throw new ApiError(404, "Catalog not found.");

    const expectedKey = input.kind === "pdf" ? catalog.pendingSourceKey : catalog.pendingCoverKey;
    if (!expectedKey || input.key !== expectedKey || !input.key.startsWith(`catalogs/${id}/`)) {
      throw new ApiError(400, "Upload token is invalid or expired.", "INVALID_UPLOAD");
    }
    const expectedSize = input.kind === "pdf" ? catalog.pendingSourceSize : catalog.pendingCoverSize;
    const expectedType = input.kind === "pdf" ? catalog.pendingSourceContentType : catalog.pendingCoverContentType;
    const [head, prefix] = await Promise.all([objectHead(input.key), readObjectPrefix(input.key, 16)]);
    if (Number(head.ContentLength) !== expectedSize) throw new ApiError(400, "Uploaded file size does not match the selected file.");
    if (head.ContentType !== expectedType) throw new ApiError(415, "Uploaded file type does not match the selected file.");

    if (input.kind === "pdf") {
      if (prefix.subarray(0, 5).toString("ascii") !== "%PDF-") throw new ApiError(415, "The uploaded file is not a valid PDF.");
      Object.assign(catalog, {
        sourceKey: input.key,
        sourcePdfUrl: undefined,
        sourceType: "uploaded",
        sourceSize: Number(head.ContentLength),
        sourceEtag: head.ETag,
        sourceContentType: expectedType,
        originalFilename: catalog.pendingSourceFilename,
        pendingSourceKey: undefined,
        pendingSourceSize: undefined,
        pendingSourceContentType: undefined,
        pendingSourceFilename: undefined,
        status: "processing",
        processingProgress: 1,
        processingMessage: "Queued for processing…",
        processingError: "",
        updatedBy: staff.userId,
      });
      await catalog.save();
      await ProcessingJob.create({ catalogId: catalog._id, status: "queued", availableAt: new Date() });
    } else {
      if (!isImageHeader(prefix, expectedType)) throw new ApiError(415, "The uploaded cover is not a valid image.");
      Object.assign(catalog, {
        coverImageKey: input.key,
        coverContentType: expectedType,
        pendingCoverKey: undefined,
        pendingCoverSize: undefined,
        pendingCoverContentType: undefined,
        updatedBy: staff.userId,
      });
      await catalog.save();
    }
    return NextResponse.json({ ok: true, status: catalog.status });
  } catch (error) { return apiError(error); }
}
