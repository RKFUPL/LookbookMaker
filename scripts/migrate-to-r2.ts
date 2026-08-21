import mongoose from "mongoose";
import { connectDb } from "../src/lib/db";
import { Catalog } from "../src/models/Catalog";
import { ProcessingJob } from "../src/models/ProcessingJob";
import type { ProductLink } from "../src/types/catalog";

const confirmed = process.argv.includes("--confirm");

async function main() {
  await connectDb();
  const catalogs = await Catalog.find({
    $or: [
      { sourceUrl: { $exists: true, $nin: ["", null] } },
      { sourcePdfUrl: { $exists: true, $nin: ["", null] } },
    ],
  }).select("+pendingProductLinks").sort({ createdAt: 1 });
  if (!catalogs.length) {
    console.log("No external-URL catalogs found.");
    return;
  }

  console.log(`${confirmed ? "Migrating" : "Dry run:"} ${catalogs.length} catalog(s) to R2 processing.`);
  for (const catalog of catalogs) {
    const id = String(catalog._id);
    const sourceUrl = catalog.sourceUrl || catalog.sourcePdfUrl;
    console.log(`- ${catalog.slug} (${id}) ${sourceUrl || "missing source URL"}`);
    if (!confirmed) continue;
    if (!sourceUrl) continue;

    const pendingProductLinks = (catalog.pages as unknown as Array<{ page: number; productLinks?: ProductLink[] }> || []).map((page) => ({
      page: page.page,
      productLinks: (page.productLinks || []).map((product: ProductLink) => ({
        sku: product.sku,
        label: product.label,
        href: product.href,
        x: product.x ?? undefined,
        y: product.y ?? undefined,
        width: product.width ?? undefined,
        height: product.height ?? undefined,
      })),
    }));

    await ProcessingJob.deleteMany({ catalogId: catalog._id, status: { $in: ["queued", "leased", "failed"] } });
    catalog.sourceKey = undefined;
    catalog.sourcePdfUrl = sourceUrl;
    catalog.sourceUrl = sourceUrl;
    catalog.sourceType = "external_url";
    catalog.sourceSize = undefined;
    catalog.sourceEtag = undefined;
    catalog.sourceContentType = undefined;
    catalog.originalFilename = undefined;
    if (!catalog.coverImageKey || catalog.coverImageKey.startsWith(`catalogs/${id}/pages/`) || catalog.coverImageKey.startsWith(`catalogs/${id}/assets/`)) {
      catalog.coverImageKey = undefined;
      catalog.coverContentType = undefined;
    }
    catalog.assetVersion = undefined;
    catalog.assetBasePrefix = undefined;
    catalog.set({ pendingProductLinks, pages: [] });
    catalog.pageCount = 0;
    catalog.width = 0;
    catalog.height = 0;
    catalog.status = "processing";
    catalog.processingProgress = 1;
    catalog.processingMessage = "Queued to rebuild assets in R2...";
    catalog.processingError = "";
    await catalog.save();
    await ProcessingJob.create({ catalogId: catalog._id, status: "queued", availableAt: new Date() });
  }
  if (!confirmed) console.log("Nothing changed. Re-run with --confirm after configuring STORAGE_PROVIDER=r2 and the R2 variables.");
  else console.log("Migration queued. Source PDFs remain on their external URLs; no local source copies were created.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await mongoose.disconnect(); });
