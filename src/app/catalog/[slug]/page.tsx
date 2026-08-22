import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connectDb } from "@/lib/db";
import { appUrl } from "@/lib/config";
import { serializePublicCatalog } from "@/lib/catalog-serializer";
import { Catalog } from "@/models/Catalog";
import { CatalogViewer } from "@/components/viewer/CatalogViewer";

export const dynamic = "force-dynamic";

async function getCatalog(slug: string) {
  await connectDb();
  const catalog = await Catalog.findOne({ slug: slug.toLowerCase(), status: "published" });
  if (!catalog) return null;
  const payload = await serializePublicCatalog(catalog);
  console.info("[RK CATALOG]", {
    slug: payload.slug,
    resolvedCatalogId: payload.id,
    sourcePdfUrl: catalog.sourcePdfUrl || "",
    pdfProxyUrl: `/api/catalogs/${payload.id}/pdf`,
  });
  return payload;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const slug = (await params).slug;
  const catalog = await getCatalog(slug);
  if (!catalog) return { title: "Catalog unavailable", robots: { index: false, follow: false } };
  const description = catalog.description || `Explore ${catalog.title} by Rashika Kapoor.`;
  return {
    title: catalog.title,
    description,
    alternates: { canonical: `${appUrl()}/catalog/${catalog.slug}` },
    openGraph: {
      type: "website",
      url: `${appUrl()}/catalog/${catalog.slug}`,
      siteName: "Rashika Kapoor",
      title: catalog.title,
      description,
      images: [],
    },
    twitter: { card: "summary", title: catalog.title, description },
  };
}

export default async function PublicCatalogPage({ params }: { params: Promise<{ slug: string }> }) {
  const catalog = await getCatalog((await params).slug);
  if (!catalog) notFound();
  return <CatalogViewer key={catalog.slug} catalog={catalog} />;
}
