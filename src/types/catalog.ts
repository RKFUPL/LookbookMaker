export type CatalogStatus = "draft" | "imported" | "published" | "failed" | "archived";
export type CatalogFailureCode = "source_missing" | "invalid_source";

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
  publicUrl: string;
  downloadUrl: string | null;
  settings: {
    allowDownload: boolean;
    showBackButton: boolean;
  };
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
  coverImageUrl: null;
  sourcePdfUrl: string;
  sourceType: "external_url";
  originalFilename: string;
  sourceSize: number;
  allowDownload: boolean;
  showBackButton: boolean;
  views: number;
  publicUrl: string;
  downloadUrl: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};
