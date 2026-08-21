"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BookOpen, Plus, Search } from "lucide-react";
import { CatalogCard } from "@/components/admin/CatalogCard";
import type { CatalogDto } from "@/types/catalog";

type Counts = Record<string, number>;
const tabs = [
  { value: "", label: "All catalogs" },
  { value: "draft", label: "Drafts" },
  { value: "processing", label: "Processing" },
  { value: "ready", label: "Ready" },
  { value: "published", label: "Published" },
  { value: "processing_failed", label: "Processing failed" },
  { value: "storage_failed", label: "Storage failed" },
  { value: "archived", label: "Archived" },
];

export function CatalogDashboard({ initialStatus }: { initialStatus: string }) {
  const [status, setStatus] = useState(tabs.some((tab) => tab.value === initialStatus) ? initialStatus : "");
  const [query, setQuery] = useState("");
  const [catalogs, setCatalogs] = useState<CatalogDto[]>([]);
  const [counts, setCounts] = useState<Counts>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (status) params.set("status", status);
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`/api/catalogs?${params}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load catalogs.");
      setCatalogs(body.catalogs);
      setCounts(body.counts || {});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load catalogs.");
    } finally { setLoading(false); }
  }, [query, status]);

  useEffect(() => {
    const timer = window.setTimeout(load, query ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query]);

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return (
    <main className="admin-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow" style={{ color: "var(--wine)" }}>Publication library</div>
          <h1>Catalogs</h1>
          <p>Create, review, and share every RK collection.</p>
        </div>
        <Link className="btn btn-primary" href="/admin/catalogs/new"><Plus size={15} /> Create catalog</Link>
      </div>

      <section className="stats-row" aria-label="Catalog summary">
        <div className="stat"><div className="stat-label">Total catalogues</div><div className="stat-value">{total}</div></div>
        <div className="stat"><div className="stat-label">Published</div><div className="stat-value">{counts.published || 0}</div></div>
        <div className="stat"><div className="stat-label">Ready to publish</div><div className="stat-value">{counts.ready || 0}</div></div>
        <div className="stat"><div className="stat-label">Total views</div><div className="stat-value">{catalogs.reduce((sum, item) => sum + item.views, 0).toLocaleString()}</div></div>
      </section>

      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Filter catalogs">
          {tabs.map((tab) => <button key={tab.value} type="button" role="tab" aria-selected={status === tab.value} className={`tab ${status === tab.value ? "active" : ""}`} onClick={() => setStatus(tab.value)}>{tab.label}</button>)}
        </div>
        <div className="search"><Search size={16} /><input className="input" type="search" placeholder="Search collections…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      </div>

      {error && <div className="error-box" style={{ marginBottom: 20 }}>{error} <button type="button" className="btn btn-ghost" onClick={load}>Retry</button></div>}
      <section className="catalog-grid" aria-live="polite">
        {loading ? Array.from({ length: 6 }).map((_, index) => <div className="catalog-card" key={index}><div className="catalog-cover skeleton" /><div className="catalog-body"><div className="skeleton" style={{ height: 12, width: "35%" }} /><div className="skeleton" style={{ height: 28, marginTop: 12 }} /></div></div>) : null}
        {!loading && catalogs.map((catalog) => <CatalogCard key={catalog.id} catalog={catalog} onChanged={load} />)}
        {!loading && !catalogs.length && <div className="empty-state"><BookOpen size={28} /><h2>No catalogues here yet</h2><p>{query ? "Try a different search." : "Begin with a PDF and turn it into an editorial digital experience."}</p><Link className="btn btn-primary" href="/admin/catalogs/new"><Plus size={15} /> Create catalog</Link></div>}
      </section>
    </main>
  );
}
