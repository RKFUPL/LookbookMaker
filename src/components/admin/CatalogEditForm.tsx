"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Send, Unlink } from "lucide-react";
import type { CatalogDto } from "@/types/catalog";

async function jsonRequest(url: string, options: RequestInit = {}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) }, cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

export function CatalogEditForm({ id }: { id: string }) {
  const [catalog, setCatalog] = useState<CatalogDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void jsonRequest(`/api/catalogs/${id}`).then((body) => setCatalog(body.catalog)).catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load catalog.")).finally(() => setLoading(false));
  }, [id]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      const pdfUrl = String(data.get("pdfUrl") || "").trim(); const update = { title: data.get("title"), collection: data.get("collection"), season: data.get("season"), description: data.get("description"), ...(pdfUrl ? { pdfUrl } : {}), allowDownload: data.get("allowDownload") === "on", showBackButton: data.get("showBackButton") === "on" };
      const body = await jsonRequest(`/api/catalogs/${id}`, { method: "PUT", body: JSON.stringify(update) });
      setCatalog(body.catalog); setMessage("Saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Save failed."); } finally { setBusy(false); }
  }

  async function uploadLocal(form: HTMLFormElement) {
    const file = new FormData(form).get("localFile");
    if (!(file instanceof File) || !file.size) { setError("Choose a PDF file to upload."); return; }
    setBusy(true); setError("");
    try {
      const body = new FormData(); body.set("file", file);
      const response = await fetch(`/api/catalogs/${id}/local-upload`, { method: "POST", body });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "PDF replacement failed.");
      setCatalog(payload.catalog); setMessage("PDF replaced successfully.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "PDF replacement failed."); } finally { setBusy(false); }
  }

  async function action(path: string) {
    setBusy(true); setError("");
    try { const body = await jsonRequest(`/api/catalogs/${id}/${path}`, { method: "POST" }); setCatalog(body.catalog || catalog); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Action failed."); } finally { setBusy(false); }
  }

  if (loading) return <main className="admin-content"><div className="skeleton" style={{ height: 520 }} /></main>;
  if (!catalog) return <main className="admin-content"><div className="error-box">{error || "Catalog not found."}</div></main>;
  return <main className="admin-content">
    <div className="page-heading"><div><div className="eyebrow" style={{ color: "var(--wine)" }}>{catalog.collection} · {catalog.status}</div><h1>Edit catalog</h1><p>Update the publication details or replace its PDF in persistent local storage.</p></div><div style={{ display: "flex", gap: 9 }}>{(catalog.sourcePdfUrl || catalog.sourceType !== "external_url") && <Link className="btn btn-secondary" href={`/admin/catalogs/${id}/preview`}>Preview</Link>}{catalog.status === "imported" && <button className="btn btn-primary" type="button" onClick={() => void action("publish")} disabled={busy}><Send size={14} /> Publish</button>}{catalog.status === "published" && <button className="btn btn-secondary" type="button" onClick={() => void action("unpublish")} disabled={busy}><Unlink size={14} /> Unpublish</button>}</div></div>
    {error && <div className="error-box" style={{ marginBottom: 18 }}>{error}</div>}{message && <div className="upload-status">{message}</div>}
    <form className="form-card" onSubmit={save}><section className="form-section"><h2>Publication details</h2><div className="form-grid">
      <div className="field wide"><label htmlFor="title">Catalog name</label><input className="input" id="title" name="title" defaultValue={catalog.title} required /></div>
      <div className="field"><label htmlFor="collection">Collection</label><input className="input" id="collection" name="collection" defaultValue={catalog.collection} required /></div>
      <div className="field"><label htmlFor="season">Season / year</label><input className="input" id="season" name="season" defaultValue={catalog.season} /></div>
      <div className="field wide"><label htmlFor="description">Description</label><textarea className="textarea" id="description" name="description" defaultValue={catalog.description} /></div>
      {catalog.sourceType === "external_url" && <div className="field wide"><label htmlFor="pdfUrl">Legacy external PDF source URL</label><input className="input" id="pdfUrl" name="pdfUrl" type="url" defaultValue={catalog.sourcePdfUrl} /><span className="field-hint">Kept only for existing legacy catalogs.</span></div>}
      <div className="field wide"><label htmlFor="localFile">Replace PDF</label><input className="input" id="localFile" name="localFile" type="file" accept="application/pdf,.pdf" /><button className="btn btn-secondary" type="button" onClick={(event) => void uploadLocal(event.currentTarget.form!)} disabled={busy}>Upload replacement</button></div>
      <label className="check-row wide"><input type="checkbox" name="allowDownload" defaultChecked={catalog.allowDownload} /> Allow original PDF download</label><label className="check-row wide"><input type="checkbox" name="showBackButton" defaultChecked={catalog.showBackButton} /> Show back button</label>
    </div><div className="form-actions"><button className="btn btn-primary" type="submit" disabled={busy}>Save changes</button></div></section></form>
  </main>;
}
