import mongoose from "mongoose";
import { connectDb } from "../src/lib/db";
import { deletePrefix } from "../src/lib/storage";
import { Catalog } from "../src/models/Catalog";
import { ProcessingJob } from "../src/models/ProcessingJob";
import type { ProductLink } from "../src/types/catalog";

const confirmed = process.argv.includes("--confirm");

async function main() {
  await connectDb();
  const catalogs = await Catalog.find({ sourceUrl: { $exists: true, $nin: ["", null] } }).select("+pendingProductLinks").sort({ createdAt: 1 });
  if (!catalogs.length) {
    console.log("No catalogs with sourceUrl found.");
    return;
  }

  console.log(`${confirmed ? "Migrating" : "Dry run:"} ${catalogs.length} catalog(s) to Render local storage.`);
  for (const catalog of catalogs) {
    const id = String(catalog._id);
    console.log(`- ${catalog.slug} (${id})`);
    if (!confirmed) continue;

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
    await deletePrefix(`catalogs/${id}/`).catch((error) => console.warn(`Unable to remove old local files for ${catalog.slug}:`, error));
    await ProcessingJob.deleteMany({ catalogId: catalog._id, status: { $in: ["queued", "leased", "failed"] } });

    catalog.sourceKey = undefined;
    catalog.sourceSize = undefined;
    catalog.sourceEtag = undefined;
    catalog.sourceContentType = undefined;
    catalog.originalFilename = undefined;
    catalog.coverImageKey = undefined;
    catalog.coverContentType = undefined;
    catalog.assetVersion = undefined;
    catalog.set({ pendingProductLinks, pages: [] });
    catalog.pageCount = 0;
    catalog.width = 0;
    catalog.height = 0;
    catalog.status = "processing";
    catalog.processingProgress = 1;
    catalog.processingMessage = "Queued to rebuild on Render local storage...";
    catalog.processingError = "";
    await catalog.save();
    await ProcessingJob.create({ catalogId: catalog._id, status: "queued", availableAt: new Date() });
  }
  if (!confirmed) console.log("Nothing changed. Re-run with --confirm to clear old local object paths and queue reprocessing.");
  else console.log("Migration queued. Remote PDFs were not modified.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await mongoose.disconnect(); });
