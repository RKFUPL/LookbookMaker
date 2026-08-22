export type CatalogStatus = "draft" | "downloading" | "processing" | "ready" | "published" | "failed" | "archived";
export type CatalogFailureCode = "download_failed" | "processing_failed" | "storage_missing";

export type ProductLink = {
  sku: string;
  label: string;
  href: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export type CatalogPage = {
  page: number;
  width: number;
  height: number;
  imageUrl: string;
  thumbnailUrl: string;
  mediumUrl: string;
  largeUrl: string;
  productLinks: ProductLink[];
};

export type PublicCatalogPage = {
  page: number;
  width: number;
  height: number;
  thumbnailUrl: string;
  mediumUrl: string;
  largeUrl: string;
  productLinks: ProductLink[];
};

export type PublicCatalogDto = {
  id: string;
  title: string;
  slug: string;
  collection: string;
  season: string;
  description: string;
  pageCount: number;
  width: number;
  height: number;
  coverImageUrl: string | null;
  publicUrl: string;
  downloadUrl: string | null;
  settings: {
    allowDownload: boolean;
    showBackButton: boolean;
  };
  pages?: PublicCatalogPage[];
};

export type CatalogDto = {
  id: string;
  title: string;
  slug: string;
  collection: string;
  season: string;
  description: string;
  status: CatalogStatus;
  pageCount: number;
  width: number;
  height: number;
  processingProgress: number;
  processingMessage: string;
  processingError: string;
  failureCode: CatalogFailureCode | null;
  failureDetail: string;
  coverImageUrl: string | null;
  sourcePdfUrl: string;
  sourceType?: "external_url" | "uploaded";
  assetBasePrefix?: string;
  originalFilename: string;
  sourceSize: number;
  allowDownload: boolean;
  showBackButton: boolean;
  views: number;
  publicUrl: string;
  pages?: CatalogPage[];
  downloadUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};
