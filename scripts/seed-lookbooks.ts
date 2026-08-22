import mongoose from "mongoose";
import lookbooks from "../data/lookbooks.json";
import { connectDb } from "../src/lib/db";
import { Catalog } from "../src/models/Catalog";
import { User } from "../src/models/User";

type Lookbook = (typeof lookbooks)[number];

async function main() {
  await connectDb();
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || "staff@rashikapoorofficial.com").toLowerCase();
  const staff = await User.findOne({ email, active: true });
  if (!staff) throw new Error(`Staff account not found for ${email}.`);
  for (const definition of lookbooks as Lookbook[]) {
    const source = definition.pdfUrl || "";
    const update = {
      slug: definition.slug,
      title: definition.title,
      collectionName: definition.collection,
      season: definition.season,
      description: definition.description,
      ...(source ? { sourcePdfUrl: source, sourceType: "external_url", status: "imported" } : { status: "draft" }),
      processingMessage: "External PDF mode — pages load in the browser.",
      updatedBy: staff._id,
    };
    const existing = await Catalog.findOne({ $or: [{ slug: definition.slug }, ...(definition.legacySlug ? [{ slug: definition.legacySlug }] : [])] });
    await Catalog.findOneAndUpdate(
      existing ? { _id: existing._id } : { slug: definition.slug },
      {
        $set: update,
        $setOnInsert: { slug: definition.slug, createdBy: staff._id, allowDownload: true, showBackButton: false },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    console.log(`Seeded ${definition.slug} (${source ? "imported" : "draft"}).`);
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(async () => { await mongoose.disconnect(); });
