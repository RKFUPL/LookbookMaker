"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Check, ChevronDown, Cloud, FolderOpen, LoaderCircle, RefreshCw } from "lucide-react";

type Status = { status: string; error?: string; connection?: { folderName: string; folderId?: string } };

function shortId(value?: string) {
  return value && value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

export default function WorkDriveSettingsPage() {
  const [result, setResult] = useState<Status | null>(null);
  const [busy, setBusy] = useState(true);
  const [tested, setTested] = useState(false);

  async function testConnection() {
    setBusy(true);
    setTested(true);
    try {
      const response = await fetch("/api/settings/workdrive/status", { method: "POST", credentials: "include" });
      const body = await response.json().catch(() => ({}));
      setResult(response.ok ? body : { status: "connection_error", error: body.error || "WorkDrive connection test failed." });
    } catch {
      setResult({ status: "connection_error", error: "The connection test could not reach the application server." });
    } finally { setBusy(false); }
  }

  useEffect(() => { const timer = window.setTimeout(() => { void testConnection(); }, 0); return () => window.clearTimeout(timer); }, []);

  const connected = result?.status === "connected";
  const failed = Boolean(result && !connected && result.status !== "not_connected");
  const label = busy ? "Checking connection" : connected ? "Connected" : result?.status === "not_connected" ? "Not connected" : result?.status === "connection_expired" ? "Connection expired" : "Connection error";

  return (
    <main className="admin-content workdrive-settings">
      <div className="page-heading workdrive-heading">
        <div><p className="eyebrow">Studio settings</p><h1>WorkDrive connection</h1><p>Keep your catalogue PDFs organized in a private, dependable workspace.</p></div>
        <div className="workdrive-heading-mark" aria-hidden="true"><Cloud size={22} strokeWidth={1.4} /></div>
      </div>

      <section className="workdrive-card" aria-labelledby="workdrive-card-title">
        <div className="workdrive-card-top"><div className="workdrive-icon"><Cloud size={21} strokeWidth={1.5} /></div><div><p className="eyebrow">Zoho integration</p><h2 id="workdrive-card-title">WorkDrive storage</h2></div><span className={`workdrive-badge ${busy ? "is-loading" : connected ? "is-connected" : "is-error"}`}><span className="workdrive-badge-dot" />{label}</span></div>
        <div className="workdrive-divider" />
        <div className="workdrive-status-grid">
          <div><p className="workdrive-label">Connection status</p><p className={`workdrive-status-value ${connected ? "is-positive" : failed ? "is-negative" : ""}`}>{busy ? <><LoaderCircle className="workdrive-spin" size={17} /> Contacting Zoho…</> : connected ? <><Check size={17} /> Ready for uploads</> : <><AlertCircle size={17} /> {label}</>}</p></div>
          {connected && result.connection && <div><p className="workdrive-label">Destination folder</p><p className="workdrive-folder"><FolderOpen size={17} /><span>{result.connection.folderName}</span>{result.connection.folderId && <code title="Shortened folder identifier">{shortId(result.connection.folderId)}</code>}</p></div>}
        </div>
        {connected && tested && <div className="workdrive-notice success" role="status"><Check size={16} /> Connection tested successfully. Your configured root folder is accessible.</div>}
        {result?.error && <div className="workdrive-notice error" role="alert"><AlertCircle size={16} /><span>{result.error}</span></div>}
        <div className="workdrive-actions"><button className="btn btn-primary" type="button" onClick={() => void testConnection()} disabled={busy}><RefreshCw className={busy ? "workdrive-spin" : ""} size={15} />{busy ? "Testing connection" : "Test connection"}</button><button className="btn btn-secondary" type="button" disabled title="OAuth credentials are managed through the server environment">Reconnect</button></div>
      </section>

      <section className="workdrive-config" aria-labelledby="configuration-title"><div><p className="eyebrow">Configuration</p><h2 id="configuration-title">Managed securely on the server</h2><p>OAuth credentials and the destination folder are read from server environment variables. They are never displayed here or sent to the browser.</p></div><details><summary><span>View required settings</span><ChevronDown size={16} /></summary><div className="workdrive-help"><code>ZOHO_WORKDRIVE_CLIENT_ID</code><code>ZOHO_WORKDRIVE_CLIENT_SECRET</code><code>ZOHO_WORKDRIVE_REFRESH_TOKEN</code><code>ZOHO_WORKDRIVE_FOLDER_ID</code><p>Use the Self Client refresh token, not the temporary authorization code. Restart Next.js after changing environment values.</p></div></details></section>
    </main>
  );
}
