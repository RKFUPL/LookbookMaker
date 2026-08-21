"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { Check, FileText, ImagePlus, LoaderCircle, RotateCcw, Upload, X } from "lucide-react";
import type { CatalogDto } from "@/types/catalog";

type Stage = "idle" | "uploading" | "processing" | "ready" | "error";

function putFile(url: string, file: File, contentType: string, onProgress: (value: number) => void, onXhr: (xhr: XMLHttpRequest) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    onXhr(xhr);
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); };
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage upload failed (${xhr.status}). Check object-storage CORS settings.`));
    xhr.onerror = () => reject(new Error("Storage upload failed. Check your connection and object-storage CORS settings."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    xhr.send(file);
  });
}

async function jsonRequest(url: string, options: RequestInit = {}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

export function CatalogCreateForm() {
  const [pdf, setPdf] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState("");
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState<CatalogDto | null>(null);
  const [formValues, setFormValues] = useState<Record<string, FormDataEntryValue> | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const pdfInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (coverPreview) URL.revokeObjectURL(coverPreview); }, [coverPreview]);

  function chooseCover(file: File | undefined) {
    setCover(file || null);
    setCoverPreview(file ? URL.createObjectURL(file) : "");
  }

  function choosePdf(file: File | undefined) {
    setError("");
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) { setError("Choose a valid PDF file."); return; }
    if (file.size > 250 * 1024 * 1024) { setError("The PDF exceeds the 250 MB upload limit."); return; }
    setPdf(file);
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setDragging(false); choosePdf(event.dataTransfer.files[0]);
  }

  async function uploadOne(id: string, file: File, kind: "pdf" | "cover", updateProgress = false) {
    const initialized = await jsonRequest(`/api/catalogs/${id}/upload`, {
      method: "POST",
      body: JSON.stringify({ kind, filename: file.name, size: file.size, contentType: kind === "pdf" ? "application/pdf" : file.type }),
    });
    await putFile(initialized.uploadUrl, file, initialized.headers["Content-Type"], (value) => updateProgress && setProgress(value), (xhr) => { xhrRef.current = xhr; });
    await jsonRequest(`/api/catalogs/${id}/upload/complete`, { method: "POST", body: JSON.stringify({ kind, key: initialized.key }) });
  }

  async function poll(id: string) {
    setStage("processing");
    for (let attempt = 0; attempt < 900; attempt += 1) {
      const body = await jsonRequest(`/api/catalogs/${id}`);
      const current: CatalogDto = body.catalog;
      setCatalog(current);
      setProgress(current.processingProgress);
      setMessage(current.processingMessage || "Processing catalog…");
      if (current.status === "ready" || current.status === "published") { setStage("ready"); return; }
      if (current.status === "error") throw new Error(current.processingError || "Catalog processing failed.");
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }
    throw new Error("Processing is taking longer than expected. It will continue in the background and appear on the dashboard when ready.");
  }

  async function begin(values: Record<string, FormDataEntryValue>, existingId?: string) {
    if (!pdf) { setError("Select a PDF to continue."); return; }
    setError(""); setStage("uploading"); setProgress(0); setMessage("Preparing secure upload…");
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
            allowDownload: values.allowDownload === "on",
            showBackButton: values.showBackButton === "on",
          }),
        });
        setCatalog(created.catalog); id = created.catalog.id;
      }
      if (cover) { setMessage("Uploading cover image…"); await uploadOne(id!, cover, "cover"); }
      setMessage("Uploading PDF to secure storage…");
      await uploadOne(id!, pdf, "pdf", true);
      xhrRef.current = null;
      await poll(id!);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload failed.");
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
            <div className="field wide"><label htmlFor="title">Catalog name</label><input className="input" id="title" name="title" required minLength={2} maxLength={160} placeholder="Hastakala Wedding Edit" disabled={stage !== "idle" && stage !== "error"} /></div>
            <div className="field"><label htmlFor="collection">Collection</label><input className="input" id="collection" name="collection" required maxLength={120} placeholder="Hastakala" disabled={stage !== "idle" && stage !== "error"} /></div>
            <div className="field"><label htmlFor="season">Season / year</label><input className="input" id="season" name="season" required maxLength={80} placeholder="Wedding 2026" disabled={stage !== "idle" && stage !== "error"} /></div>
            <div className="field wide"><label htmlFor="description">Description</label><textarea className="textarea" id="description" name="description" maxLength={2000} placeholder="A short editorial introduction to this collection…" disabled={stage !== "idle" && stage !== "error"} /></div>
            <label className="check-row wide"><input type="checkbox" name="allowDownload" defaultChecked disabled={stage !== "idle" && stage !== "error"} /><span><strong>Allow PDF download</strong><br /><span className="field-hint">Customers may download the original document through a short-lived secure link.</span></span></label>
            <label className="check-row wide"><input type="checkbox" name="showBackButton" disabled={stage !== "idle" && stage !== "error"} /><span><strong>Show back button in viewer</strong><br /><span className="field-hint">Useful when the catalog is opened from the RK website.</span></span></label>
          </div>
        </section>

        <section className="form-section">
          <h2>Publication file</h2><p>PDFs are uploaded directly to object storage and processed in the background.</p>
          <input ref={pdfInput} className="sr-only" type="file" accept="application/pdf,.pdf" onChange={(event) => choosePdf(event.target.files?.[0])} />
          <div className={`dropzone ${dragging ? "dragging" : ""} ${pdf ? "has-file" : ""}`} role="button" tabIndex={0} onClick={() => stage === "idle" && pdfInput.current?.click()} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && stage === "idle") pdfInput.current?.click(); }} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>
            <div className="dropzone-icon">{pdf ? <FileText size={22} /> : <Upload size={22} />}</div>
            <div>{pdf ? <><strong>{pdf.name}</strong><span>{(pdf.size / 1024 / 1024).toFixed(1)} MB · PDF document</span></> : <><strong>Drag PDF here</strong><span>or click to browse · maximum 250 MB</span></>}</div>
            {pdf && stage === "idle" && <button className="icon-btn" type="button" aria-label="Remove PDF" onClick={(event) => { event.stopPropagation(); setPdf(null); }}><X size={16} /></button>}
          </div>
          <div className="cover-picker">
            <label><ImagePlus size={18} /> {coverPreview && <img className="cover-preview" src={coverPreview} alt="Selected cover" />}<span>{cover ? cover.name : "Add an optional cover image"}</span><input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseCover(event.target.files?.[0])} disabled={stage !== "idle" && stage !== "error"} /></label>
          </div>
          {stage !== "idle" && <div className="upload-status">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>{stage === "ready" ? <Check size={18} color="var(--success)" /> : stage === "error" ? <X size={18} color="var(--danger)" /> : <LoaderCircle size={18} className="spinner" />}<strong>{stage === "ready" ? "Catalog ready" : stage === "error" ? "Action needed" : message}</strong></div>
            {stage !== "error" && <><div className="progress-track"><div className="progress-bar" style={{ width: `${progress}%` }} /></div><div className="progress-meta"><span>{stage === "processing" ? "Rendering optimized pages" : "Secure object-storage upload"}</span><span>{progress}%</span></div></>}
          </div>}
          {error && <div className="error-box" style={{ marginTop: 16 }}>{error}</div>}
          <div className="form-actions">
            {stage === "uploading" && <button className="btn btn-secondary" type="button" onClick={() => xhrRef.current?.abort()}>Cancel upload</button>}
            {stage === "error" && formValues && <button className="btn btn-secondary" type="button" onClick={() => begin(formValues, catalog?.id)}><RotateCcw size={14} /> Retry</button>}
            {stage === "ready" && catalog ? <><Link className="btn btn-secondary" href={`/admin/catalogs/${catalog.id}/preview`}>Preview</Link><Link className="btn btn-primary" href={`/admin/catalogs/${catalog.id}/edit`}>Review & publish</Link></> : <button className="btn btn-primary" type="submit" disabled={!pdf || !["idle", "error"].includes(stage)}>{stage === "idle" ? "Create & upload" : "Working…"}</button>}
          </div>
        </section>
      </div>
    </form>
  );
}
