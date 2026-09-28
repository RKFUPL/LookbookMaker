import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { apiError, ApiError } from "@/lib/http";
import { getConfig } from "@/lib/config";
import { validateUpload } from "@/lib/pdf-upload";
import { uploadWorkDrivePdf } from "@/lib/workdrive";
import { uniqueSlug } from "@/lib/slug";
import { Catalog } from "@/models/Catalog";
import { serializeCatalog } from "@/lib/catalog-serializer";
import { workDriveCatalogMetadata } from "@/lib/workdrive-catalog";

type CatalogUploadPromise = Promise<InstanceType<typeof Catalog>>;
const uploadPromises = new Map<string, CatalogUploadPromise>();
const REQUEST_ID = /^[a-zA-Z0-9_-]{16,100}$/;

export async function POST(request: Request) {
  try {
    const staff = await requireStaff();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "Choose a PDF file.", "PDF_REQUIRED");
    await validateUpload(file, getConfig().ZOHO_WORKDRIVE_MAX_UPLOAD_MB * 1024 * 1024);
    const title = String(form.get("title") || "").trim();
    const collection = String(form.get("collection") || "").trim();
    const uploadRequestId = String(form.get("uploadRequestId") || "").trim();
    if (title.length < 2 || !collection) throw new ApiError(400, "Catalog title and collection are required.", "VALIDATION_ERROR");
    if (!REQUEST_ID.test(uploadRequestId)) throw new ApiError(400, "The upload request identifier is invalid. Please reload the form and try again.", "UPLOAD_REQUEST_INVALID");
    await connectDb();
    const existing = await Catalog.findOne({ createdBy: staff.userId, uploadRequestId });
    if (existing) return NextResponse.json({ catalog: await serializeCatalog(existing) });
    const requestKey = `${staff.userId}:${uploadRequestId}`;
    let operation = uploadPromises.get(requestKey);
    if (!operation) {
      operation = (async () => {
        let uploaded: Awaited<ReturnType<typeof uploadWorkDrivePdf>>;
        try {
          uploaded = await uploadWorkDrivePdf(file, collection, title);
        } catch (error) {
          uploadPromises.delete(requestKey);
          throw error;
        }
        try {
          return await Catalog.create({ title, collectionName: collection, season: String(form.get("season") || "").trim(), description: String(form.get("description") || "").trim(), ...workDriveCatalogMetadata(uploaded, file.name, staff.userId), uploadRequestId, slug: await uniqueSlug(title), status: "imported", processingProgress: 100, processingMessage: "WorkDrive PDF mode — pages load through the server.", createdBy: staff.userId, updatedBy: staff.userId, allowDownload: form.get("allowDownload") === "true", showBackButton: form.get("showBackButton") === "true" });
        } catch {
          throw new ApiError(500, "Catalog save failed after WorkDrive upload. This request is paused to prevent another WorkDrive copy; an administrator must reconcile the orphaned upload before retrying.", "WORKDRIVE_ORPHAN_POSSIBLE");
        }
      })();
      uploadPromises.set(requestKey, operation);
      setTimeout(() => uploadPromises.delete(requestKey), 10 * 60_000).unref?.();
    }
    const catalog = await operation;
    return NextResponse.json({ catalog: await serializeCatalog(catalog) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
