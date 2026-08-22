import mongoose from "mongoose";
import { connectDb } from "../src/lib/db";
import { resolveCatalogSource } from "../src/lib/catalog-source";
import { Catalog } from "../src/models/Catalog";

async function main() {
  await connectDb();
  const catalogs = await Catalog.find({ $or: [{ sourcePdfUrl: { $exists: false } }, { sourcePdfUrl: "" }] });
  let migrated = 0;
  for (const catalog of catalogs) {
    const source = resolveCatalogSource(catalog);
    if (!source.sourcePdfUrl) {
      console.log(`Missing source: ${catalog.slug}`);
      continue;
    }
    await Catalog.updateOne(
      { _id: catalog._id },
      { $set: { sourcePdfUrl: source.sourcePdfUrl, sourceType: "external_url" } },
    );
    migrated += 1;
    console.log(`Migrated ${catalog.slug} from ${source.field}.`);
  }
  console.log(`Catalog source migration complete: ${migrated} migrated, ${catalogs.length - migrated} missing.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(async () => {
  await mongoose.disconnect();
});
