"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import type { CatalogDto } from "@/types/catalog";

export function CatalogCreateForm() {
  const [catalog, setCatalog] = useState<CatalogDto | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const data = new FormData(event.currentTarget); const file = data.get("file");
    try {
      let body: { catalog: CatalogDto };
      if (file instanceof File && file.size) {
        const upload = new FormData(); for (const key of ["title", "collection", "season", "description"]) upload.set(key, String(data.get(key) || "")); upload.set("allowDownload", data.get("allowDownload") === "on" ? "true" : "false"); upload.set("showBackButton", data.get("showBackButton") === "on" ? "true" : "false"); upload.set("file", file);
        const response = await fetch("/api/catalogs/upload", { method: "POST", body: upload }); body = await response.json(); if (!response.ok) throw new Error((body as unknown as { error?: string }).error || "WorkDrive upload failed.");
      } else {
        const response = await fetch("/api/catalogs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: data.get("title"), collection: data.get("collection"), season: data.get("season"), description: data.get("description"), pdfUrl: String(data.get("pdfUrl") || "").trim(), allowDownload: data.get("allowDownload") === "on", showBackButton: data.get("showBackButton") === "on" }) }); body = await response.json(); if (!response.ok) throw new Error((body as unknown as { error?: string }).error || "Unable to import catalog.");
      }
      setCatalog(body.catalog);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create catalog."); } finally { setBusy(false); }
  }
  async function publish() { if (!catalog) return; setBusy(true); try { const response = await fetch(`/api/catalogs/${catalog.id}/publish`, { method: "POST" }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Unable to publish catalog."); setCatalog(body.catalog); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to publish catalog."); } finally { setBusy(false); } }
  if (catalog) return <div className="upload-status"><strong>Catalog uploaded.</strong><p>PDF metadata is stored in MongoDB and the PDF is stored in WorkDrive.</p><div className="form-actions"><Link className="btn btn-secondary" href={`/admin/catalogs/${catalog.id}/preview`}>Preview</Link><button className="btn btn-primary" type="button" onClick={() => void publish()} disabled={busy}><Send size={14} /> Publish</button></div></div>;
  return <form onSubmit={submit}><div className="form-card"><section className="form-section"><h2>Lookbook details</h2><div className="form-grid"><div className="field wide"><label htmlFor="title">Catalog name</label><input className="input" id="title" name="title" required /></div><div className="field wide"><label htmlFor="collection">Collection</label><input className="input" id="collection" name="collection" required /></div><div className="field"><label htmlFor="season">Season / year</label><input className="input" id="season" name="season" /></div><div className="field wide"><label htmlFor="description">Description</label><textarea className="textarea" id="description" name="description" /></div><div className="field wide"><label htmlFor="file">Upload PDF to WorkDrive</label><input className="input" id="file" name="file" type="file" accept="application/pdf,.pdf" /><span className="field-hint">The backend validates the extension, MIME type, signature, and size.</span></div><div className="field wide"><label htmlFor="pdfUrl">Legacy external PDF URL</label><input className="input" id="pdfUrl" name="pdfUrl" type="url" placeholder="https://example.com/file.pdf" /></div><label className="check-row wide"><input type="checkbox" name="allowDownload" defaultChecked /> Allow original PDF download</label><label className="check-row wide"><input type="checkbox" name="showBackButton" /> Show back button</label></div>{error && <div className="error-box">{error}</div>}<div className="form-actions"><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Uploading…" : "IMPORT CATALOG"}</button></div></section></div></form>;
}
