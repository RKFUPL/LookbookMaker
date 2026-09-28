"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Cloud, RefreshCw } from "lucide-react";

type Status = { configured: boolean; connected: boolean; code: string; message: string; rootFolderIdConfigured: boolean; rootFolderName?: string };

export function WorkDriveConnection() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function check() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/integrations/workdrive/status", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to check WorkDrive.");
      setStatus(body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to check WorkDrive."); }
    finally { setLoading(false); }
  }

  useEffect(() => { const timer = window.setTimeout(() => { void check(); }, 0); return () => window.clearTimeout(timer); }, []);

  return <main className="admin-content">
    <div className="page-heading"><div><div className="eyebrow">Settings</div><h1>WorkDrive connection</h1><p className="muted">Server-side storage for uploaded catalog PDFs.</p></div><button className="btn btn-ghost" type="button" onClick={() => void check()} disabled={loading}><RefreshCw size={15} /> {loading ? "Checking…" : "Test connection"}</button></div>
    <section className="panel" style={{ maxWidth: 760 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}><Cloud size={24} /><div style={{ flex: 1 }}><h2 style={{ marginTop: 0 }}>Connection status</h2>{loading && <p className="muted">Checking the server configuration and root folder…</p>}{error && <p className="error-text"><CircleAlert size={16} /> {error}</p>}{status && <><p className={status.connected ? "success-text" : "error-text"}>{status.connected ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />} {status.message}</p>{status.connected && status.rootFolderName && <p className="muted">Root folder: {status.rootFolderName}</p>}</>}</div></div>
      <hr />
      <h3>Configuration</h3>
      <p className="muted">The root <code>ZOHO_WORKDRIVE_FOLDER_ID</code> is an environment setting. This page never displays or changes OAuth credentials, tokens, or private WorkDrive URLs.</p>
      <p className="muted">To change the root folder, update the server environment, restart the app, then use Test connection. Collection folders are created automatically beneath that root when a PDF is uploaded.</p>
      <p className="muted">Required server scopes: <code>WorkDrive.files.READ</code> and <code>WorkDrive.files.CREATE</code>.</p>
    </section>
  </main>;
}
