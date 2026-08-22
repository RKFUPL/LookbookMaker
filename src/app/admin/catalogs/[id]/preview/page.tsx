import { isValidObjectId } from "mongoose";
import { notFound } from "next/navigation";
import { connectDb } from "@/lib/db";
import { serializePublicCatalog } from "@/lib/catalog-serializer";
import { Catalog } from "@/models/Catalog";
import { CatalogViewer } from "@/components/viewer/CatalogViewer";

export const metadata = { title: "Catalog preview", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  if (!isValidObjectId(id)) notFound();
  await connectDb();
  const document = await Catalog.findById(id);
  if (!document || !document.sourcePdfUrl) notFound();
  const catalog = await serializePublicCatalog(document);
  return <CatalogViewer catalog={catalog} preview />;
}
