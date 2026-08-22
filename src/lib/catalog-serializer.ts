import type { ICatalog } from "@/models/Catalog";
import { appUrl } from "@/lib/config";
import type { CatalogDto, CatalogFailureCode, CatalogStatus, PublicCatalogDto } from "@/types/catalog";

type CatalogLike = ICatalog & { _id: unknown; createdAt: Date; updatedAt: Date };

function normalizedStatus(status: string): CatalogStatus {
  if (status === "published") return "published";
  if (status === "archived") return "archived";
  if (status === "failed") return "failed";
  if (status === "draft") return "draft";
  return "imported";
}

function normalizedFailureCode(catalog: CatalogLike): CatalogFailureCode | null {
  if (catalog.failureCode === "invalid_source" || catalog.failureCode === "source_missing") return catalog.failureCode;
  return null;
}

function sourceUrl(catalog: CatalogLike) {
  return catalog.sourcePdfUrl || "";
}

export async function serializeCatalog(catalog: CatalogLike): Promise<CatalogDto> {
  const pdfUrl = sourceUrl(catalog);
  return {
    id: String(catalog._id),
    title: catalog.title,
    slug: catalog.slug,
    collection: catalog.collectionName,
    season: catalog.season || "",
    description: catalog.description || "",
    status: normalizedStatus(String(catalog.status)),
    pageCount: catalog.pageCount || 0,
    width: catalog.width || 0,
    height: catalog.height || 0,
    processingProgress: catalog.pageCount ? 100 : 0,
    processingMessage: "External PDF mode — pages load in the browser.",
    processingError: catalog.processingError || "",
    failureCode: normalizedFailureCode(catalog),
    failureDetail: catalog.failureDetail || "",
    coverImageUrl: null,
    sourcePdfUrl: pdfUrl,
    sourceType: "external_url",
    originalFilename: catalog.originalFilename || "",
    sourceSize: catalog.sourceSize || 0,
    allowDownload: catalog.allowDownload,
    showBackButton: catalog.showBackButton,
    views: catalog.views || 0,
    publicUrl: `${appUrl()}/catalog/${catalog.slug}`,
    downloadUrl: catalog.allowDownload ? `${appUrl()}/api/catalogs/${catalog.slug}/download` : null,
    createdAt: catalog.createdAt.toISOString(),
    updatedAt: catalog.updatedAt.toISOString(),
    publishedAt: catalog.publishedAt?.toISOString() || null,
  };
}

export async function serializePublicCatalog(catalog: CatalogLike): Promise<PublicCatalogDto> {
  const pdfUrl = sourceUrl(catalog);
  return {
    id: String(catalog._id),
    title: catalog.title,
    slug: catalog.slug,
    collection: catalog.collectionName,
    season: catalog.season || "",
    description: catalog.description || "",
    pageCount: catalog.pageCount || 0,
    width: catalog.width || 0,
    height: catalog.height || 0,
    sourcePdfUrl: pdfUrl,
    publicUrl: `${appUrl()}/catalog/${catalog.slug}`,
    downloadUrl: catalog.allowDownload ? `${appUrl()}/api/catalogs/${catalog.slug}/download` : null,
    settings: { allowDownload: catalog.allowDownload, showBackButton: catalog.showBackButton },
  };
}
