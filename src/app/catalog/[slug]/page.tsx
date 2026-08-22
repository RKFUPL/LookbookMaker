import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connectDb } from "@/lib/db";
import { appUrl } from "@/lib/config";
import { serializePublicCatalog } from "@/lib/catalog-serializer";
import { Catalog } from "@/models/Catalog";
import { CatalogViewer } from "@/components/viewer/CatalogViewer";

export const dynamic = "force-dynamic";

async function getCatalog(slug: string, assets = true) {
  await connectDb();
  const catalog = await Catalog.findOne({ slug: slug.toLowerCase(), status: "published" });
  if (!catalog) return null;
  return serializePublicCatalog(catalog, assets);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const slug = (await params).slug;
  const catalog = await getCatalog(slug, false);
  if (!catalog) return { title: "Catalog unavailable", robots: { index: false, follow: false } };
  const description = catalog.description || `Explore ${catalog.title} by Rashika Kapoor.`;
  const coverImage = catalog.coverImageUrl ? new URL(catalog.coverImageUrl, appUrl()).toString() : null;
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
      images: coverImage ? [{ url: coverImage, alt: catalog.title }] : [],
    },
    twitter: { card: "summary_large_image", title: catalog.title, description, images: coverImage ? [coverImage] : [] },
  };
}

export default async function PublicCatalogPage({ params }: { params: Promise<{ slug: string }> }) {
  // Send the lightweight reader shell first. Page asset URLs are loaded from the
  // public API by the client so the RK loading state can paint immediately.
  const catalog = await getCatalog((await params).slug, false);
  if (!catalog) notFound();
  return <CatalogViewer catalog={catalog} />;
}
