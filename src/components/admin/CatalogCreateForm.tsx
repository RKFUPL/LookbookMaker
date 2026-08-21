"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Check, ImagePlus, LoaderCircle, RotateCcw, X } from "lucide-react";
import type { CatalogDto } from "@/types/catalog";

type Stage = "idle" | "processing" | "ready" | "error";

async function jsonRequest(url: string, options: RequestInit = {}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

async function uploadCover(id: string, file: File) {
  const initialized = await jsonRequest(`/api/catalogs/${id}/upload`, {
    method: "POST",
    body: JSON.stringify({ kind: "cover", filename: file.name, size: file.size, contentType: file.type }),
  });
  const response = await fetch(initialized.uploadUrl, { method: "PUT", headers: { "Content-Type": initialized.headers["Content-Type"] }, body: file });
  if (!response.ok) throw new Error("Cover upload failed. Check your connection.");
  await jsonRequest(`/api/catalogs/${id}/upload/complete`, { method: "POST", body: JSON.stringify({ kind: "cover", key: initialized.key }) });
}

export function CatalogCreateForm() {
  const [cover, setCover] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState<CatalogDto | null>(null);
  const [formValues, setFormValues] = useState<Record<string, FormDataEntryValue> | null>(null);

  useEffect(() => () => { if (coverPreview) URL.revokeObjectURL(coverPreview); }, [coverPreview]);

  function chooseCover(file: File | undefined) {
    setCover(file || null);
    setCoverPreview(file ? URL.createObjectURL(file) : "");
  }

  async function poll(id: string) {
    setStage("processing");
    for (let attempt = 0; attempt < 900; attempt += 1) {
      const current: CatalogDto = (await jsonRequest(`/api/catalogs/${id}`)).catalog;
      setCatalog(current);
      setProgress(current.processingProgress);
      setMessage(current.processingMessage || "Processing catalog...");
      if (current.status === "ready" || current.status === "published") { setStage("ready"); return; }
      if (current.status === "error") throw new Error(current.processingError || "Catalog processing failed.");
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }
    throw new Error("Processing is continuing in the background. It will appear on the dashboard when ready.");
  }

  async function begin(values: Record<string, FormDataEntryValue>, existingId?: string) {
    const sourceUrl = String(values.sourceUrl || "").trim();
    if (!sourceUrl) { setError("Add the URL where the PDF is stored."); return; }
    setError(""); setStage("processing"); setProgress(1); setMessage("Fetching the source PDF...");
    try {
      let id = existingId;
      if (!id) {
        const created = await jsonRequest("/api/catalogs", {
          method: "POST",
          body: JSON.stringify({
            title: values.title,
            collection: values.collection,
            season: values.season,
            description: values.description,
            sourceUrl,
            allowDownload: values.allowDownload === "on",
            showBackButton: values.showBackButton === "on",
          }),
        });
        setCatalog(created.catalog); id = created.catalog.id;
      } else {
        const current: CatalogDto = (await jsonRequest(`/api/catalogs/${id}`)).catalog;
        if (current.sourceUrl !== sourceUrl) {
          await jsonRequest(`/api/catalogs/${id}`, {
            method: "PUT",
            body: JSON.stringify({
              title: values.title,
              collection: values.collection,
              season: values.season,
              description: values.description,
              sourceUrl,
              allowDownload: values.allowDownload === "on",
              showBackButton: values.showBackButton === "on",
            }),
          });
        } else if (current.status === "error") {
          await jsonRequest(`/api/catalogs/${id}/process`, { method: "POST" });
        }
      }
      if (cover) { setMessage("Uploading cover image..."); await uploadCover(id!, cover); }
      await poll(id!);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to process the PDF URL.");
      setStage("error");
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    setFormValues(values);
    void begin(values);
  }

  return (
    <form onSubmit={submit}>
      <div className="form-card">
        <section className="form-section">
          <h2>Catalogue details</h2><p>These details appear in the staff library and on shared links.</p>
          <div className="form-grid">
            <div className="field wide"><label htmlFor="title">Catalog name</label><input className="input" id="title" name="title" required minLength={2} maxLength={160} placeholder="Anamika Lookbook" disabled={stage !== "idle" && stage !== "error"} /></div>
            <div className="field"><label htmlFor="collection">Collection</label><input className="input" id="collection" name="collection" required maxLength={120} placeholder="Anamika" disabled={stage !== "idle" && stage !== "error"} /></div>
            <div className="field"><label htmlFor="season">Season / year</label><input className="input" id="season" name="season" required maxLength={80} placeholder="Wedding 2026" disabled={stage !== "idle" && stage !== "error"} /></div>
            <div className="field wide"><label htmlFor="description">Description</label><textarea className="textarea" id="description" name="description" maxLength={2000} placeholder="A short editorial introduction to this collection..." disabled={stage !== "idle" && stage !== "error"} /></div>
            <label className="check-row wide"><input type="checkbox" name="allowDownload" defaultChecked disabled={stage !== "idle" && stage !== "error"} /><span><strong>Allow PDF download</strong><br /><span className="field-hint">Customers may download the original document through a short-lived secure link.</span></span></label>
            <label className="check-row wide"><input type="checkbox" name="showBackButton" disabled={stage !== "idle" && stage !== "error"} /><span><strong>Show back button in viewer</strong><br /><span className="field-hint">Useful when the catalog is opened from the RK website.</span></span></label>
          </div>
        </section>

        <section className="form-section">
          <h2>PDF source</h2><p>Paste the public URL where the PDF is stored. RK Fashion will fetch it and build the optimized flipbook in the background.</p>
          <div className="field wide"><label htmlFor="sourceUrl">PDF storage URL</label><input className="input" id="sourceUrl" name="sourceUrl" type="url" required placeholder="https://example.com/catalog.pdf" disabled={stage !== "idle" && stage !== "error"} /><span className="field-hint">The URL must be reachable by the server and return a PDF. Maximum 250 MB.</span></div>
          <div className="cover-picker">
            <label><ImagePlus size={18} /> {coverPreview && <img className="cover-preview" src={coverPreview} alt="Selected cover" />}<span>{cover ? cover.name : "Add an optional cover image"}</span><input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseCover(event.target.files?.[0])} disabled={stage !== "idle" && stage !== "error"} /></label>
          </div>
          {stage !== "idle" && <div className="upload-status">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>{stage === "ready" ? <Check size={18} color="var(--success)" /> : stage === "error" ? <X size={18} color="var(--danger)" /> : <LoaderCircle size={18} className="spinner" />}<strong>{stage === "ready" ? "Catalog ready" : stage === "error" ? "Action needed" : message}</strong></div>
            {stage !== "error" && <><div className="progress-track"><div className="progress-bar" style={{ width: `${progress}%` }} /></div><div className="progress-meta"><span>{stage === "processing" ? "Fetching and optimizing pages" : "Preparing catalog"}</span><span>{progress}%</span></div></>}
          </div>}
          {error && <div className="error-box" style={{ marginTop: 16 }}>{error}</div>}
          <div className="form-actions">
            {stage === "error" && formValues && <button className="btn btn-secondary" type="button" onClick={() => void begin(formValues, catalog?.id)}><RotateCcw size={14} /> Retry</button>}
            {stage === "ready" && catalog ? <><Link className="btn btn-secondary" href={`/admin/catalogs/${catalog.id}/preview`}>Preview</Link><Link className="btn btn-primary" href={`/admin/catalogs/${catalog.id}/edit`}>Review & publish</Link></> : <button className="btn btn-primary" type="submit" disabled={!['idle', 'error'].includes(stage)}>{stage === "idle" ? "Create from URL" : "Working..."}</button>}
          </div>
        </section>
      </div>
    </form>
  );
}
