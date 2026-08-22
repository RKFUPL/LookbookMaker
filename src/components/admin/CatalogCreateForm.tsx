"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Check, LoaderCircle, RotateCcw, Send, X } from "lucide-react";
import type { CatalogDto } from "@/types/catalog";

type Stage = "idle" | "processing" | "ready" | "published" | "error";

async function jsonRequest(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

export function CatalogCreateForm() {
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState<CatalogDto | null>(null);
  const [submittedValues, setSubmittedValues] = useState<Record<string, FormDataEntryValue> | null>(null);

  async function poll(id: string) {
    setStage("processing");
    for (let attempt = 0; attempt < 900; attempt += 1) {
      const current: CatalogDto = (await jsonRequest(`/api/catalogs/${id}`)).catalog;
      setCatalog(current);
      setProgress(current.processingProgress);
      setMessage(current.processingMessage || "Processing pages...");
      if (current.status === "ready" || current.status === "published") {
        setStage(current.status === "published" ? "published" : "ready");
        return;
      }
      if (current.status === "failed") {
        const detail = current.failureDetail ? ` ${current.failureDetail}` : "";
        throw new Error(`${current.processingError || "Unable to import this PDF."}${detail}`);
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }
    throw new Error("Processing is continuing in the background. It will appear on the dashboard when ready.");
  }

  async function begin(values: Record<string, FormDataEntryValue>, existingId?: string) {
    const pdfUrl = String(values.pdfUrl || "").trim();
    if (!pdfUrl) {
      setError("Add the HTTPS URL where the PDF is hosted.");
      return;
    }
    setError("");
    setStage("processing");
    setProgress(1);
    setMessage("Downloading PDF...");

    try {
      let id = existingId;
      if (!id) {
        const created = await jsonRequest("/api/catalogs", {
          method: "POST",
          body: JSON.stringify({
            title: values.title,
            collection: values.collection,
            description: values.description,
            pdfUrl,
            allowDownload: values.allowDownload === "on",
            showBackButton: values.showBackButton === "on",
          }),
        });
        setCatalog(created.catalog);
        id = created.catalog.id;
      } else {
        const current: CatalogDto = (await jsonRequest(`/api/catalogs/${id}`)).catalog;
        if (current.sourcePdfUrl !== pdfUrl) {
          await jsonRequest(`/api/catalogs/${id}`, {
            method: "PUT",
            body: JSON.stringify({
              title: values.title,
              collection: values.collection,
              description: values.description,
              pdfUrl,
              allowDownload: values.allowDownload === "on",
              showBackButton: values.showBackButton === "on",
            }),
          });
        } else if (current.status === "failed") {
          await jsonRequest(`/api/catalogs/${id}/process`, { method: "POST" });
        }
      }
      await poll(id!);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to import this PDF.");
      setStage("error");
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    setSubmittedValues(values);
    void begin(values, catalog?.status === "failed" ? catalog.id : undefined);
  }

  async function publish() {
    if (!catalog) return;
    setError("");
    try {
      const published: CatalogDto = (await jsonRequest(`/api/catalogs/${catalog.id}/publish`, { method: "POST" })).catalog;
      setCatalog(published);
      setStage("published");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to publish this lookbook.");
    }
  }

  const editable = stage === "idle" || stage === "error";
  return (
    <form onSubmit={submit}>
      <div className="form-card">
        <section className="form-section">
          <h2>Lookbook details</h2>
          <p>Add the details customers will see with this collection.</p>
          <div className="form-grid">
            <div className="field wide"><label htmlFor="title">Catalog name</label><input className="input" id="title" name="title" required minLength={2} maxLength={160} placeholder="Sandook Lookbook" disabled={!editable} /></div>
            <div className="field wide"><label htmlFor="collection">Collection</label><input className="input" id="collection" name="collection" required maxLength={120} placeholder="Sandook" disabled={!editable} /></div>
            <div className="field wide"><label htmlFor="description">Description</label><textarea className="textarea" id="description" name="description" maxLength={2000} placeholder="A short editorial introduction to this collection..." disabled={!editable} /></div>
            <label className="check-row wide"><input type="checkbox" name="allowDownload" defaultChecked disabled={!editable} /><span><strong>Allow PDF download</strong><br /><span className="field-hint">Customers can open the original hosted PDF.</span></span></label>
            <label className="check-row wide"><input type="checkbox" name="showBackButton" disabled={!editable} /><span><strong>Show back button in viewer</strong></span></label>
          </div>
        </section>

        <section className="form-section">
          <h2>PDF URL</h2>
          <p>The server downloads and converts this PDF. The browser never processes the original document.</p>
          <div className="field wide">
            <label htmlFor="pdfUrl">PDF URL</label>
            <input className="input" id="pdfUrl" name="pdfUrl" type="url" required placeholder="https://gentle-kangaroo.staticdomains.app/SANDOOKLOOKBOOK.pdf" disabled={!editable} />
            <span className="field-hint">Must use HTTPS and return a valid PDF within the configured size limit.</span>
          </div>

          {stage !== "idle" && <div className="upload-status">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {stage === "ready" || stage === "published" ? <Check size={18} color="var(--success)" /> : stage === "error" ? <X size={18} color="var(--danger)" /> : <LoaderCircle size={18} className="spinner" />}
              <strong>{stage === "ready" ? "Lookbook ready ✓" : stage === "published" ? "Lookbook published ✓" : stage === "error" ? "Action needed" : message}</strong>
            </div>
            {stage !== "error" && <><div className="progress-track"><div className="progress-bar" style={{ width: `${progress}%` }} /></div><div className="progress-meta"><span>{message || "Preparing lookbook..."}</span><span>{progress}%</span></div></>}
          </div>}
          {error && <div className="error-box" style={{ marginTop: 16 }}>{error}</div>}

          <div className="form-actions">
            {stage === "error" && submittedValues && <button className="btn btn-secondary" type="button" onClick={() => void begin(submittedValues, catalog?.id)}><RotateCcw size={14} /> Retry</button>}
            {stage === "ready" && catalog && <><Link className="btn btn-secondary" href={`/admin/catalogs/${catalog.id}/preview`}>Preview</Link><button className="btn btn-primary" type="button" onClick={() => void publish()}><Send size={14} /> Publish</button></>}
            {stage === "published" && catalog && <a className="btn btn-primary" href={catalog.publicUrl} target="_blank" rel="noreferrer">Open lookbook</a>}
            {(stage === "idle" || stage === "error") && <button className="btn btn-primary" type="submit">IMPORT &amp; CREATE LOOKBOOK</button>}
          </div>
        </section>
      </div>
    </form>
  );
}
