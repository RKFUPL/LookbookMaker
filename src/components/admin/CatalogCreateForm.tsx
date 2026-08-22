"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Check, Send, X } from "lucide-react";
import type { CatalogDto } from "@/types/catalog";

async function jsonRequest(url: string, options: RequestInit = {}) {
  const response = await fetch(url, { ...options, cache: "no-store", headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

export function CatalogCreateForm() {
  const [stage, setStage] = useState<"idle" | "imported" | "published" | "error">("idle");
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState<CatalogDto | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setStage("idle");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const body = await jsonRequest("/api/catalogs", { method: "POST", body: JSON.stringify({ title: values.title, collection: values.collection, season: values.season, description: values.description, pdfUrl: String(values.pdfUrl || "").trim(), allowDownload: values.allowDownload === "on", showBackButton: values.showBackButton === "on" }) });
      setCatalog(body.catalog); setStage("imported");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to import this PDF."); setStage("error"); }
  }
  async function publish() {
    if (!catalog) return;
    try { const body = await jsonRequest(`/api/catalogs/${catalog.id}/publish`, { method: "POST" }); setCatalog(body.catalog); setStage("published"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to publish this catalog."); }
  }

  const locked = stage === "imported" || stage === "published";
  return <form onSubmit={submit}><div className="form-card">
    <section className="form-section"><h2>Lookbook details</h2><p>MongoDB stores this metadata; the browser reads the hosted PDF directly.</p><div className="form-grid">
      <div className="field wide"><label htmlFor="title">Catalog name</label><input className="input" id="title" name="title" required minLength={2} maxLength={160} placeholder="Sandook Lookbook" disabled={locked} /></div>
      <div className="field wide"><label htmlFor="collection">Collection</label><input className="input" id="collection" name="collection" required maxLength={120} placeholder="Sandook" disabled={locked} /></div>
      <div className="field"><label htmlFor="season">Season / year</label><input className="input" id="season" name="season" maxLength={80} placeholder="2026" disabled={locked} /></div>
      <div className="field wide"><label htmlFor="description">Description</label><textarea className="textarea" id="description" name="description" maxLength={2000} placeholder="A short editorial introduction..." disabled={locked} /></div>
      <label className="check-row wide"><input type="checkbox" name="allowDownload" defaultChecked disabled={locked} /><span><strong>Allow original PDF download</strong><br /><span className="field-hint">Opens the same hosted PDF source.</span></span></label>
      <label className="check-row wide"><input type="checkbox" name="showBackButton" disabled={locked} /><span><strong>Show back button in viewer</strong></span></label>
    </div></section>
    <section className="form-section"><h2>External PDF URL</h2><p>Use a public HTTPS PDF URL with browser CORS enabled. No server disk or permanent page assets are used.</p><div className="field wide"><label htmlFor="pdfUrl">PDF URL</label><input className="input" id="pdfUrl" name="pdfUrl" type="url" required placeholder="https://example.com/lookbook.pdf" disabled={locked} /><span className="field-hint">The PDF host must allow browser access (CORS) and range requests where possible.</span></div>
      {stage !== "idle" && <div className="upload-status"><div style={{ display: "flex", alignItems: "center", gap: 10 }}>{stage === "imported" || stage === "published" ? <Check size={18} color="var(--success)" /> : <X size={18} color="var(--danger)" />}<strong>{stage === "imported" ? "Catalog imported" : stage === "published" ? "Catalog published" : "Action needed"}</strong></div><div className="progress-meta"><span>External PDF mode — pages load in the browser.</span></div></div>}
      {error && <div className="error-box" style={{ marginTop: 16 }}>{error}</div>}
      <div className="form-actions">{stage === "imported" && catalog && <><Link className="btn btn-secondary" href={`/admin/catalogs/${catalog.id}/preview`}>Preview</Link><button className="btn btn-primary" type="button" onClick={() => void publish()}><Send size={14} /> Publish</button></>}{stage === "published" && catalog && <a className="btn btn-primary" href={catalog.publicUrl} target="_blank" rel="noreferrer">Open lookbook</a>}{(stage === "idle" || stage === "error") && <button className="btn btn-primary" type="submit">IMPORT CATALOG</button>}</div>
    </section>
  </div></form>;
}
