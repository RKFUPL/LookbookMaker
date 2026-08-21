import { isValidObjectId } from "mongoose";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { apiError, ApiError } from "@/lib/http";
import { uniqueSlug } from "@/lib/slug";
import { copyObject, deletePrefix } from "@/lib/storage";
import { serializeCatalog } from "@/lib/catalog-serializer";
import { Catalog } from "@/models/Catalog";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  let duplicateId: string | null = null;
  try {
    const staff = await requireStaff();
    await connectDb();
    const id = (await params).id;
    if (!isValidObjectId(id)) throw new ApiError(404, "Catalog not found.");
    const source = await Catalog.findById(id);
    if (!source) throw new ApiError(404, "Catalog not found.");
    if (["uploading", "processing"].includes(source.status)) throw new ApiError(409, "Wait for processing to finish before duplicating.");

    const duplicate = await Catalog.create({
      title: `${source.title} — Copy`,
      slug: await uniqueSlug(`${source.title} ${source.season} copy`),
      collectionName: source.collectionName,
      season: source.season,
      description: source.description,
      sourceUrl: source.sourceUrl,
      sourcePdfUrl: source.sourcePdfUrl || source.sourceUrl,
      sourceType: source.sourceType || (source.sourceUrl ? "external_url" : source.sourceKey ? "uploaded" : undefined),
      status: source.pageCount ? "ready" : "draft",
      pageCount: source.pageCount,
      width: source.width || source.pages?.[0]?.width || 0,
      height: source.height || source.pages?.[0]?.height || 0,
      allowDownload: source.allowDownload,
      showBackButton: source.showBackButton,
      createdBy: staff.userId,
      updatedBy: staff.userId,
      processingProgress: source.pageCount ? 100 : 0,
      processingMessage: source.pageCount ? "Catalog ready" : "",
    });
    const targetId = String(duplicate._id);
    duplicateId = targetId;

    if (source.sourceKey) {
      const target = `catalogs/${targetId}/source/source.pdf`;
      await copyObject(source.sourceKey, target);
      duplicate.sourceKey = target;
      duplicate.sourceSize = source.sourceSize;
      duplicate.sourceEtag = source.sourceEtag;
      duplicate.sourceContentType = source.sourceContentType;
      duplicate.originalFilename = source.originalFilename;
    }
    if (!duplicate.originalFilename && source.originalFilename) duplicate.originalFilename = source.originalFilename;

    const pages = [];
    for (const page of source.pages || []) {
      const stem = String(page.page).padStart(4, "0");
      const sourceMediumKey = page.mediumKey || page.largeKey || page.imageKey || page.thumbnailKey;
      const sourceLargeKey = page.largeKey || page.imageKey || page.mediumKey || page.thumbnailKey;
      const mediumKey = `catalogs/${targetId}/pages/medium/${stem}.webp`;
      const largeKey = `catalogs/${targetId}/pages/large/${stem}.webp`;
      const thumbnailKey = `catalogs/${targetId}/thumbnails/${stem}.webp`;
      await Promise.all([
        copyObject(sourceMediumKey, mediumKey),
        copyObject(sourceLargeKey, largeKey),
        copyObject(page.thumbnailKey, thumbnailKey),
      ]);
      pages.push({
        page: page.page,
        width: page.width,
        height: page.height,
        imageKey: largeKey,
        thumbnailKey,
        mediumKey,
        largeKey,
        productLinks: page.productLinks || [],
      });
      if ([page.imageKey, page.mediumKey, page.largeKey].includes(source.coverImageKey)) duplicate.coverImageKey = largeKey;
    }
    if (source.coverImageKey && !duplicate.coverImageKey) {
      const extension = source.coverContentType?.split("/")[1]?.replace("jpeg", "jpg") || "webp";
      const coverKey = `catalogs/${targetId}/cover/cover.${extension}`;
      await copyObject(source.coverImageKey, coverKey);
      duplicate.coverImageKey = coverKey;
    }
    duplicate.coverContentType = source.coverContentType;
    duplicate.pages = pages;
    await duplicate.save();
    return NextResponse.json({ catalog: await serializeCatalog(duplicate) }, { status: 201 });
  } catch (error) {
    if (duplicateId) {
      await Promise.allSettled([
        Catalog.deleteOne({ _id: duplicateId }),
        deletePrefix(`catalogs/${duplicateId}/`),
      ]);
    }
    return apiError(error);
  }
}
