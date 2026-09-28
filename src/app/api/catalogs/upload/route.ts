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

export async function POST(request: Request) {
  try {
    const staff = await requireStaff();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "Choose a PDF file.", "PDF_REQUIRED");
    await validateUpload(file, getConfig().ZOHO_WORKDRIVE_MAX_UPLOAD_MB * 1024 * 1024);
    const title = String(form.get("title") || "").trim();
    const collection = String(form.get("collection") || "").trim();
    if (title.length < 2 || !collection) throw new ApiError(400, "Catalog title and collection are required.", "VALIDATION_ERROR");
    const uploaded = await uploadWorkDrivePdf(file, collection, title);
    await connectDb();
    let catalog;
    try { catalog = await Catalog.create({ title, collectionName: collection, season: String(form.get("season") || "").trim(), description: String(form.get("description") || "").trim(), sourceType: "workdrive", workdriveFileId: uploaded.id, workdriveFileName: uploaded.name, workdriveFolderId: uploaded.folderId, workdriveRootFolderId: uploaded.rootFolderId, sourceSize: uploaded.size, originalFilename: file.name, uploadedAt: new Date(), uploadedBy: staff.userId, sourcePdfUrl: "", slug: await uniqueSlug(title), status: "imported", processingProgress: 100, processingMessage: "WorkDrive PDF mode — pages load through the server.", createdBy: staff.userId, updatedBy: staff.userId, allowDownload: form.get("allowDownload") === "true", showBackButton: form.get("showBackButton") === "true" }); } catch { throw new ApiError(500, "Catalog save failed after WorkDrive upload; the new WorkDrive file may need manual cleanup.", "WORKDRIVE_ORPHAN_POSSIBLE"); }
    return NextResponse.json({ catalog: await serializeCatalog(catalog) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
