import mongoose from "mongoose";
import type { HydratedDocument } from "mongoose";
import lookbooks from "../data/lookbooks.json";
import { connectDb } from "../src/lib/db";
import { deletePrefix } from "../src/lib/storage";
import { Catalog } from "../src/models/Catalog";
import type { ICatalog } from "../src/models/Catalog";
import { ProcessingJob } from "../src/models/ProcessingJob";
import { User } from "../src/models/User";

type Lookbook = (typeof lookbooks)[number];

async function findStaff() {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || "staff@rashikapoorofficial.com").toLowerCase();
  const staff = await User.findOne({ email, active: true });
  if (!staff) throw new Error(`Staff account not found for ${email}.`);
  return staff;
}

async function cancelPendingUploads() {
  const uploading = await Catalog.find({ status: "uploading" }).select("_id");
  for (const catalog of uploading) {
    const catalogId = String(catalog._id);
    await Promise.all([deletePrefix(`catalogs/${catalogId}/source/`), deletePrefix(`catalogs/${catalogId}/cover/`)]);
    await Catalog.findByIdAndUpdate(catalog._id, {
      $set: { status: "draft", processingProgress: 0, processingMessage: "Add a PDF source URL to continue.", processingError: "" },
      $unset: { pendingSourceKey: 1, pendingSourceSize: 1, pendingSourceContentType: 1, pendingSourceFilename: 1, pendingCoverKey: 1, pendingCoverSize: 1, pendingCoverContentType: 1 },
    });
    console.log(`Cancelled pending upload: ${catalogId}`);
  }
}

async function queueSource(catalog: HydratedDocument<ICatalog>, definition: Lookbook, staffId: mongoose.Types.ObjectId) {
  if (!catalog || !definition.pdfUrl) return;
  const sameSource = (catalog.sourcePdfUrl || catalog.sourceUrl) === definition.pdfUrl;
  if (sameSource && ["ready", "published", "downloading", "processing"].includes(catalog.status)) return;
  catalog.sourceUrl = undefined;
  catalog.sourcePdfUrl = definition.pdfUrl;
  catalog.sourceType = "external_url";
  catalog.sourceKey = undefined;
  catalog.sourceSize = undefined;
  catalog.sourceContentType = undefined;
  catalog.originalFilename = undefined;
  catalog.set({ pages: [] });
  catalog.pageCount = 0;
  catalog.width = 0;
  catalog.height = 0;
  catalog.assetVersion = undefined;
  catalog.assetBasePrefix = undefined;
  catalog.status = "downloading";
  catalog.processingProgress = 1;
  catalog.processingMessage = "Downloading PDF...";
  catalog.processingError = "";
  catalog.failureCode = undefined;
  catalog.failureDetail = "";
  catalog.updatedBy = staffId;
  await catalog.save();
  await ProcessingJob.deleteMany({ catalogId: catalog._id, status: { $in: ["queued", "leased", "failed"] } });
  await ProcessingJob.create({ catalogId: catalog._id, status: "queued", availableAt: new Date() });
  console.log(`Queued URL processing: ${catalog.slug}`);
}

async function createOrReuse(definition: Lookbook, staffId: mongoose.Types.ObjectId) {
  let catalog = await Catalog.findOne({ slug: definition.slug });
  if (!catalog && definition.legacySlug) {
    catalog = await Catalog.findOne({ slug: definition.legacySlug });
    if (catalog) {
      catalog.slug = definition.slug;
      console.log(`Renamed ${definition.legacySlug} to ${definition.slug}.`);
    }
  }
  if (!catalog) {
    catalog = await Catalog.create({
      title: definition.title,
      slug: definition.slug,
      collectionName: definition.collection,
      season: definition.season,
      description: definition.description,
      sourcePdfUrl: definition.pdfUrl || undefined,
      sourceType: definition.pdfUrl ? "external_url" : undefined,
      status: definition.pdfUrl ? "downloading" : "draft",
      processingProgress: definition.pdfUrl ? 1 : 0,
      processingMessage: definition.pdfUrl ? "Downloading PDF..." : "Add a PDF source URL to continue.",
      allowDownload: true,
      showBackButton: false,
      createdBy: staffId,
      updatedBy: staffId,
    });
    console.log(`Created ${catalog.slug} (${catalog.status}).`);
    if (definition.pdfUrl) await ProcessingJob.create({ catalogId: catalog._id, status: "queued", availableAt: new Date() });
    return;
  }
  catalog.title = definition.title;
  catalog.collectionName = definition.collection;
  catalog.season = definition.season;
  catalog.description = definition.description;
  catalog.updatedBy = staffId;
  await catalog.save();
  await queueSource(catalog, definition, staffId);
  console.log(`Already exists: ${catalog.slug} (${catalog.status}).`);
}

async function main() {
  await connectDb();
  const staff = await findStaff();
  await cancelPendingUploads();
  for (const definition of lookbooks) await createOrReuse(definition, staff._id as mongoose.Types.ObjectId);
  console.log("Lookbook JSON seed complete.");
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(async () => { await mongoose.disconnect(); });
