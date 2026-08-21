import type { ICatalog } from "@/models/Catalog";
import { objectUrl } from "@/lib/storage";
import type { CatalogDto, CatalogPage, PublicCatalogDto } from "@/types/catalog";

type CatalogLike = ICatalog & { _id: unknown; createdAt: Date; updatedAt: Date };

async function serializePages(catalog: CatalogLike): Promise<CatalogPage[]> {
  return Promise.all(
    (catalog.pages || []).map(async (page) => {
      const mediumKey = page.mediumKey || page.largeKey || page.imageKey || page.thumbnailKey;
      const largeKey = page.largeKey || page.imageKey || page.mediumKey || page.thumbnailKey;
      const [thumbnailUrl, mediumUrl, largeUrl] = await Promise.all([
        objectUrl(page.thumbnailKey),
        objectUrl(mediumKey),
        objectUrl(largeKey),
      ]);
      return {
        page: page.page,
        width: page.width,
        height: page.height,
        imageUrl: mediumUrl,
        thumbnailUrl,
        mediumUrl,
        largeUrl,
        productLinks: (page.productLinks || []).map((product) => ({
          sku: product.sku,
          label: product.label,
          href: product.href,
          x: product.x ?? undefined,
          y: product.y ?? undefined,
          width: product.width ?? undefined,
          height: product.height ?? undefined,
        })),
      };
    }),
  );
}

export async function serializeCatalog(catalog: CatalogLike, includeAssets = false): Promise<CatalogDto> {
  const pages = includeAssets ? await serializePages(catalog) : undefined;
  const firstPage = catalog.pages?.[0];

  return {
    id: String(catalog._id),
    title: catalog.title,
    slug: catalog.slug,
    collection: catalog.collectionName,
    season: catalog.season,
    description: catalog.description || "",
    status: catalog.status,
    pageCount: catalog.pageCount || 0,
    width: catalog.width || firstPage?.width || 0,
    height: catalog.height || firstPage?.height || 0,
    processingProgress: catalog.processingProgress || 0,
    processingMessage: catalog.processingMessage || "",
    processingError: catalog.processingError || "",
    coverImageUrl: catalog.coverImageKey ? await objectUrl(catalog.coverImageKey) : null,
    sourceUrl: catalog.sourceUrl || "",
    originalFilename: catalog.originalFilename || "",
    sourceSize: catalog.sourceSize || 0,
    allowDownload: catalog.allowDownload,
    showBackButton: catalog.showBackButton,
    views: catalog.views || 0,
    publicUrl: `/catalog/${catalog.slug}`,
    pages,
    createdAt: catalog.createdAt.toISOString(),
    updatedAt: catalog.updatedAt.toISOString(),
    publishedAt: catalog.publishedAt?.toISOString() || null,
  };
}

export async function serializePublicCatalog(catalog: CatalogLike, includeAssets = true): Promise<PublicCatalogDto> {
  const firstPage = catalog.pages?.[0];
  const publicPages = includeAssets
    ? (await serializePages(catalog)).map((page) => ({
        page: page.page,
        width: page.width,
        height: page.height,
        thumbnailUrl: page.thumbnailUrl,
        mediumUrl: page.mediumUrl,
        largeUrl: page.largeUrl,
        productLinks: page.productLinks,
      }))
    : undefined;
  return {
    id: String(catalog._id),
    title: catalog.title,
    slug: catalog.slug,
    collection: catalog.collectionName,
    season: catalog.season,
    description: catalog.description || "",
    pageCount: catalog.pageCount || catalog.pages?.length || 0,
    width: catalog.width || firstPage?.width || 0,
    height: catalog.height || firstPage?.height || 0,
    coverImageUrl: catalog.coverImageKey ? await objectUrl(catalog.coverImageKey) : null,
    publicUrl: `/catalog/${catalog.slug}`,
    downloadUrl: catalog.allowDownload ? `/api/catalogs/${catalog.slug}/download` : null,
    settings: {
      allowDownload: catalog.allowDownload,
      showBackButton: catalog.showBackButton,
    },
    pages: publicPages,
  };
}
