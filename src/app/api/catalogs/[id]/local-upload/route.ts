import { isValidObjectId } from "mongoose";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { apiError, ApiError } from "@/lib/http";
import { getConfig } from "@/lib/config";
import { validateUpload } from "@/lib/pdf-upload";
import { persistAfterLocalPdfWrite, removeLocalPdf, storeLocalPdf } from "@/lib/local-pdf-storage";
import { Catalog } from "@/models/Catalog";
import { serializeCatalog } from "@/lib/catalog-serializer";

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
    await validateUpload(file, getConfig().LOOKBOOK_MAX_UPLOAD_MB * 1024 * 1024);
    const previousKey = catalog.sourceType === "local" ? catalog.storageKey : "";
    const stored = await storeLocalPdf(file);
    Object.assign(catalog, stored, {
      uploadedBy: staff.userId,
      status: "imported",
      processingProgress: 100,
      processingMessage: "Local PDF storage — pages load through the server.",
      updatedBy: staff.userId,
    });
    await persistAfterLocalPdfWrite(stored.storageKey, () => catalog.save());
    if (previousKey && previousKey !== stored.storageKey) await removeLocalPdf(previousKey).catch(() => undefined);
    return NextResponse.json({ catalog: await serializeCatalog(catalog) });
  } catch (error) { return apiError(error); }
}
