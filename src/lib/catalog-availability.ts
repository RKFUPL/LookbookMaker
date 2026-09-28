import type { CatalogStatus } from "@/types/catalog";

type CatalogPdfSource = { sourcePdfUrl: string; sourceType: "external_url" | "workdrive" | "local"; workdriveFileId?: string; storageKey?: string; storageKeyPresent?: boolean };

export function catalogHasPdf(catalog: CatalogPdfSource) {
  if (catalog.sourceType === "local") return Boolean(catalog.storageKey || catalog.storageKeyPresent);
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
