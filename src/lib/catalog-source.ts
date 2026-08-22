import type { ICatalog } from "@/models/Catalog";

/**
 * `sourcePdfUrl` is the canonical field. Older catalog documents used
 * `sourceUrl` (and a few importers used one of the other names below), so
 * reads remain compatible while writes can migrate the value forward.
 */
const LEGACY_SOURCE_FIELDS = ["sourceUrl", "pdfUrl", "fileUrl", "documentUrl", "pdf", "source"] as const;

type CatalogSourceRecord = Partial<ICatalog> & Record<string, unknown>;

export type ResolvedCatalogSource = {
  sourcePdfUrl: string;
  field: "sourcePdfUrl" | (typeof LEGACY_SOURCE_FIELDS)[number] | null;
};

function asHttpsUrl(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || !parsed.hostname) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function resolveCatalogSource(catalog: CatalogSourceRecord): ResolvedCatalogSource {
  const canonical = asHttpsUrl(catalog.sourcePdfUrl);
  if (canonical) return { sourcePdfUrl: canonical, field: "sourcePdfUrl" };
  for (const field of LEGACY_SOURCE_FIELDS) {
    const sourcePdfUrl = asHttpsUrl(catalog[field]);
    if (sourcePdfUrl) return { sourcePdfUrl, field };
  }
  return { sourcePdfUrl: "", field: null };
}

/** Persist a legacy value when a hydrated Mongoose document is available. */
export async function normalizeCatalogSource(catalog: CatalogSourceRecord) {
  const resolved = resolveCatalogSource(catalog);
  if (resolved.sourcePdfUrl && resolved.field !== "sourcePdfUrl" && typeof catalog.save === "function") {
    catalog.sourcePdfUrl = resolved.sourcePdfUrl;
    catalog.sourceType = "external_url";
    await catalog.save();
  }
  return resolved;
}

export const supportedLegacySourceFields = LEGACY_SOURCE_FIELDS;
