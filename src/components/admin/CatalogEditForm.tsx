"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Clipboard, ExternalLink, FileText, LoaderCircle, RotateCcw, Send, Unlink, Upload } from "lucide-react";
import type { CatalogDto } from "@/types/catalog";

async function request(url: string, options: RequestInit = {}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) }, cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

export function CatalogEditForm({ id }: { id: string }) {
  const [catalog, setCatalog] = useState<CatalogDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try { setCatalog((await request(`/api/catalogs/${id}`)).catalog); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load catalog."); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => {
    let active = true;
    void request(`/api/catalogs/${id}`).then((body) => { if (active) { setCatalog(body.catalog); setError(""); } }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Unable to load catalog."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setSaved(false);
    const data = new FormData(event.currentTarget);
    try {
      const body = await request(`/api/catalogs/${id}`, { method: "PUT", body: JSON.stringify({
        title: data.get("title"), collection: data.get("collection"), season: data.get("season"), description: data.get("description"),
        allowDownload: data.get("allowDownload") === "on", showBackButton: data.get("showBackButton") === "on",
      }) });
      setCatalog(body.catalog); setSaved(true); window.setTimeout(() => setSaved(false), 1800);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Save failed."); }
    finally { setBusy(false); }
  }

  async function change(path: string) {
    setBusy(true); setError("");
    try { const body = await request(`/api/catalogs/${id}/${path}`, { method: "POST" }); if (body.catalog) setCatalog(body.catalog); else await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Action failed."); }
    finally { setBusy(false); }
  }

  async function replacePdf(file: File | undefined) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) { setError("Choose a valid PDF file."); return; }
    if (file.size > 250 * 1024 * 1024) { setError("The PDF exceeds the 250 MB upload limit."); return; }
    setUploading(true); setUploadProgress(0); setError("");
    try {
      const initialized = await request(`/api/catalogs/${id}/upload`, { method: "POST", body: JSON.stringify({ kind: "pdf", filename: file.name, size: file.size, contentType: "application/pdf" }) });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", initialized.uploadUrl);
        xhr.setRequestHeader("Content-Type", initialized.headers["Content-Type"]);
        xhr.upload.onprogress = (event) => { if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100)); };
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`));
        xhr.onerror = () => reject(new Error("Upload failed. Check your connection."));
        xhr.send(file);
      });
      await request(`/api/catalogs/${id}/upload/complete`, { method: "POST", body: JSON.stringify({ kind: "pdf", key: initialized.key }) });
      for (let attempt = 0; attempt < 900; attempt += 1) {
        const current: CatalogDto = (await request(`/api/catalogs/${id}`)).catalog;
        setCatalog(current); setUploadProgress(current.processingProgress);
        if (current.status === "ready" || current.status === "published") return;
        if (current.status === "error") throw new Error(current.processingError || "Catalog processing failed.");
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
      }
      throw new Error("Processing is continuing in the background. Refresh this page shortly.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "PDF replacement failed."); }
    finally { setUploading(false); }
  }

  if (loading) return <main className="admin-content"><div className="skeleton" style={{ height: 520 }} /></main>;
  if (!catalog) return <main className="admin-content"><div className="error-box">{error || "Catalog not found."}</div></main>;

  return (
    <main className="admin-content">
      <div className="page-heading">
        <div><div className="eyebrow" style={{ color: "var(--wine)" }}>{catalog.collection} · {catalog.status}</div><h1>Edit catalog</h1><p>Review presentation details and publication access.</p></div>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
          {catalog.pageCount > 0 && <Link className="btn btn-secondary" href={`/admin/catalogs/${id}/preview`}>Preview</Link>}
          {catalog.status === "ready" && <button className="btn btn-primary" type="button" onClick={() => change("publish")} disabled={busy}><Send size={14} /> Publish</button>}
          {catalog.status === "published" && <><button className="btn btn-secondary" type="button" onClick={() => change("unpublish")} disabled={busy}><Unlink size={14} /> Unpublish</button><a className="btn btn-primary" href={catalog.publicUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open public link</a></>}
          {catalog.status === "error" && <button className="btn btn-primary" type="button" onClick={() => change("process")} disabled={busy}><RotateCcw size={14} /> Retry processing</button>}
        </div>
      </div>
      {error && <div className="error-box" style={{ marginBottom: 18 }}>{error}</div>}
      <form className="form-card" onSubmit={save}>
        <section className="form-section">
          <h2>Publication details</h2><p>Changing the name also creates a fresh, clean public slug.</p>
          <div className="form-grid">
            <div className="field wide"><label htmlFor="title">Catalog name</label><input className="input" id="title" name="title" defaultValue={catalog.title} required minLength={2} maxLength={160} /></div>
            <div className="field"><label htmlFor="collection">Collection</label><input className="input" id="collection" name="collection" defaultValue={catalog.collection} required maxLength={120} /></div>
            <div className="field"><label htmlFor="season">Season / year</label><input className="input" id="season" name="season" defaultValue={catalog.season} required maxLength={80} /></div>
            <div className="field wide"><label htmlFor="description">Description</label><textarea className="textarea" id="description" name="description" defaultValue={catalog.description} maxLength={2000} /></div>
            <label className="check-row wide"><input type="checkbox" name="allowDownload" defaultChecked={catalog.allowDownload} /><span><strong>Allow original PDF download</strong><br /><span className="field-hint">Downloads use five-minute signed URLs and are tracked.</span></span></label>
            <label className="check-row wide"><input type="checkbox" name="showBackButton" defaultChecked={catalog.showBackButton} /><span><strong>Show viewer back button</strong></span></label>
          </div>
          <div className="form-actions"><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? <><LoaderCircle size={14} className="spinner" /> Saving</> : saved ? <><Check size={14} /> Saved</> : "Save changes"}</button></div>
        </section>
        <aside className="form-section">
          <h2>Publication</h2><p>Storage and viewer readiness at a glance.</p>
          <div className="catalog-cover" style={{ aspectRatio: "16/10", marginBottom: 22 }}>{catalog.coverImageUrl ? <img src={catalog.coverImageUrl} alt="Catalog cover" /> : <div className="catalog-cover-placeholder">RK</div>}<span className={`status-pill ${catalog.status}`}>{catalog.status}</span></div>
          <div style={{ display: "grid", gap: 14, fontSize: 13 }}>
            <div><span className="field-hint">Public address</span><div style={{ marginTop: 4, overflowWrap: "anywhere" }}>{catalog.publicUrl}</div></div>
            <div style={{ display: "flex", gap: 9 }}><button className="btn btn-secondary" type="button" onClick={async () => navigator.clipboard.writeText(`${window.location.origin}${catalog.publicUrl}`)}><Clipboard size={13} /> Copy link</button></div>
            <div><span className="field-hint">Optimized pages</span><div style={{ marginTop: 4 }}>{catalog.pageCount} pages</div></div>
            <div><span className="field-hint">Source file</span><div style={{ marginTop: 4 }}>{catalog.originalFilename || "Not uploaded"}{catalog.sourceSize ? ` · ${(catalog.sourceSize / 1024 / 1024).toFixed(1)} MB` : ""}</div></div>
            <div><span className="field-hint">Audience</span><div style={{ marginTop: 4 }}>{catalog.views.toLocaleString()} catalog views</div></div>
            {catalog.processingMessage && <div><span className="field-hint">Processing</span><div style={{ marginTop: 4 }}>{catalog.processingMessage}</div></div>}
            {!['processing'].includes(catalog.status) && <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
              <span className="field-hint">Source PDF</span>
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                <label className="btn btn-secondary" htmlFor="replace-pdf" style={{ cursor: uploading ? "wait" : "pointer" }}><Upload size={13} /> {uploading ? "Processing…" : catalog.sourceSize ? "Replace PDF" : "Upload PDF"}</label>
                <input className="sr-only" id="replace-pdf" type="file" accept="application/pdf,.pdf" disabled={uploading} onChange={(event) => { void replacePdf(event.target.files?.[0]); event.currentTarget.value = ""; }} />
                {!uploading && catalog.originalFilename && <span className="field-hint"><FileText size={13} style={{ verticalAlign: "-2px" }} /> {catalog.originalFilename}</span>}
              </div>
              {uploading && <><div className="progress-track"><div className="progress-bar" style={{ width: `${uploadProgress}%` }} /></div><div className="progress-meta"><span>{catalog.processingMessage || "Uploading and processing…"}</span><span>{uploadProgress}%</span></div></>}
            </div>}
          </div>
        </aside>
      </form>
    </main>
  );
}
