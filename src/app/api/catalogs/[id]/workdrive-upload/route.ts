import { isValidObjectId } from "mongoose";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { apiError, ApiError } from "@/lib/http";
import { getConfig } from "@/lib/config";
import { validateUpload } from "@/lib/pdf-upload";
import { uploadWorkDrivePdf } from "@/lib/workdrive";
import { Catalog } from "@/models/Catalog";
import { serializeCatalog } from "@/lib/catalog-serializer";
import { workDriveCatalogMetadata } from "@/lib/workdrive-catalog";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireStaff();
    await connectDb();
    const id = (await params).id;
    if (!isValidObjectId(id)) throw new ApiError(404, "Catalog not found.", "NOT_FOUND");
    const catalog = await Catalog.findById(id);
    if (!catalog) throw new ApiError(404, "Catalog not found.", "NOT_FOUND");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "Choose a PDF file.", "PDF_REQUIRED");
    await validateUpload(file, getConfig().ZOHO_WORKDRIVE_MAX_UPLOAD_MB * 1024 * 1024);
    const uploaded = await uploadWorkDrivePdf(file, catalog.collectionName, catalog.title);
    Object.assign(catalog, workDriveCatalogMetadata(uploaded, file.name, staff.userId));
    catalog.status = "imported";
    catalog.processingProgress = 100;
    catalog.processingMessage = "WorkDrive PDF mode — pages load through the server.";
    catalog.updatedBy = staff.userId;
    try { await catalog.save(); } catch { throw new ApiError(500, "Catalog save failed after WorkDrive upload; the new WorkDrive file may need manual cleanup.", "WORKDRIVE_ORPHAN_POSSIBLE"); }
    return NextResponse.json({ catalog: await serializeCatalog(catalog) });
  } catch (error) { return apiError(error); }
}
