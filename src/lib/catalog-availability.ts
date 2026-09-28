import type { CatalogStatus } from "@/types/catalog";

type CatalogPdfSource = { sourcePdfUrl: string; sourceType: "external_url" | "workdrive"; workdriveFileId?: string };

export function catalogHasPdf(catalog: CatalogPdfSource) {
  return catalog.sourceType === "workdrive" ? Boolean(catalog.workdriveFileId) : Boolean(catalog.sourcePdfUrl);
}

export function canAccessCatalogPdf(status: CatalogStatus | string, hasStaffSession: boolean) {
  return status === "published" || hasStaffSession;
}

export function catalogPdfProxyPath(id: string, download = false) {
  return `/api/catalogs/${encodeURIComponent(id)}/pdf${download ? "?download=1" : ""}`;
}

export function catalogPublicPath(slug: string) {
  return `/catalog/${encodeURIComponent(slug)}`;
}
