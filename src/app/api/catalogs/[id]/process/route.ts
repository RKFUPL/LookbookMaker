import { isValidObjectId } from "mongoose";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { apiError, ApiError } from "@/lib/http";
import { Catalog } from "@/models/Catalog";
import { ProcessingJob } from "@/models/ProcessingJob";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireStaff();
    await connectDb();
    const id = (await params).id;
    if (!isValidObjectId(id)) throw new ApiError(404, "Catalog not found.");
    const catalog = await Catalog.findById(id);
    if (!catalog?.sourceKey && !catalog?.sourceUrl) throw new ApiError(409, "Add a source PDF URL before processing.");
    if (["uploading", "processing"].includes(catalog.status)) throw new ApiError(409, "Catalog is already processing.");
    await ProcessingJob.create({ catalogId: catalog._id, status: "queued", availableAt: new Date() });
    catalog.status = "processing";
    catalog.processingProgress = 1;
    catalog.processingMessage = "Queued for processing…";
    catalog.processingError = "";
    await catalog.save();
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
