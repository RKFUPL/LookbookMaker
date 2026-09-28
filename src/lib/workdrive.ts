import { getConfig } from "@/lib/config";
import { ApiError } from "@/lib/http";

function config() {
  const value = getConfig();
  const missing = [
    ["ZOHO_WORKDRIVE_CLIENT_ID", value.ZOHO_WORKDRIVE_CLIENT_ID],
    ["ZOHO_WORKDRIVE_CLIENT_SECRET", value.ZOHO_WORKDRIVE_CLIENT_SECRET],
    ["ZOHO_WORKDRIVE_REFRESH_TOKEN", value.ZOHO_WORKDRIVE_REFRESH_TOKEN],
    ["ZOHO_WORKDRIVE_FOLDER_ID", value.ZOHO_WORKDRIVE_FOLDER_ID],
  ].filter(([, item]) => !item).map(([name]) => name);
  if (missing.length) {
    throw new ApiError(503, `WorkDrive is not configured. Missing: ${missing.join(", ")}.`, "WORKDRIVE_NOT_CONFIGURED");
  }
  return value;
}

export type WorkDriveConnectionStatus = {
  configured: boolean;
  connected: boolean;
  code: "CONNECTED" | "NOT_CONFIGURED" | "AUTH_FAILED" | "FOLDER_FAILED" | "CONNECTION_FAILED";
  message: string;
  rootFolderIdConfigured: boolean;
  rootFolderName?: string;
};

async function accessToken() {
  const value = config();
  let response: Response;
  try {
    response = await fetch(value.ZOHO_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: value.ZOHO_WORKDRIVE_REFRESH_TOKEN!,
        client_id: value.ZOHO_WORKDRIVE_CLIENT_ID!,
        client_secret: value.ZOHO_WORKDRIVE_CLIENT_SECRET!,
        grant_type: "refresh_token",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(502, "Unable to reach the Zoho India authorization service.", "WORKDRIVE_AUTH_NETWORK_ERROR");
  }
  const raw = await response.text();
  const payload = parseZohoErrorBody(raw);
  if (!response.ok) {
    const detail = payload.error || payload.error_description || "Zoho did not provide an error description.";
    throw new ApiError(502, `Zoho token refresh failed (HTTP ${response.status}): ${detail}${payload.error_code ? ` [${payload.error_code}]` : ""}.`, classifyZohoTokenError(payload.error || payload.error_code));
  }
  const accessToken = payload.access_token;
  if (!accessToken) {
    const detail = payload.error || payload.error_description || "Zoho returned no access token or error description.";
    throw new ApiError(502, `Zoho token refresh returned no access token (HTTP ${response.status}): ${detail}.`, classifyZohoTokenError(payload.error || payload.error_code));
  }
  return { value, token: accessToken };
}

function parseZohoErrorBody(raw: string) {
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    const pick = (key: string) => typeof body[key] === "string" ? body[key] as string : "";
    return {
      access_token: pick("access_token"),
      error: pick("error"),
      error_description: pick("error_description"),
      error_code: pick("error_code") || pick("code"),
    };
  } catch {
    return { access_token: "", error: raw.trim().slice(0, 240) || "non-JSON response", error_description: "", error_code: "" };
  }
}

function classifyZohoTokenError(error: string) {
  const normalized = error.toLowerCase();
  if (normalized.includes("invalid_client") || normalized.includes("client")) return "WORKDRIVE_CLIENT_AUTH_FAILED";
  if (normalized.includes("invalid_scope") || normalized.includes("scope")) return "WORKDRIVE_SCOPE_INVALID";
  if (normalized.includes("invalid_code") || normalized.includes("invalid_grant") || normalized.includes("refresh")) return "WORKDRIVE_REFRESH_TOKEN_INVALID";
  return "WORKDRIVE_AUTH_FAILED";
}

export type WorkDriveConnectionResult = {
  folderId: string;
  folderName: string;
  folderType: string;
};

export function getWorkDriveConfigurationStatus() {
  const value = getConfig();
  const missingVariables = [
    ["ZOHO_WORKDRIVE_CLIENT_ID", value.ZOHO_WORKDRIVE_CLIENT_ID],
    ["ZOHO_WORKDRIVE_CLIENT_SECRET", value.ZOHO_WORKDRIVE_CLIENT_SECRET],
    ["ZOHO_WORKDRIVE_REFRESH_TOKEN", value.ZOHO_WORKDRIVE_REFRESH_TOKEN],
    ["ZOHO_WORKDRIVE_FOLDER_ID", value.ZOHO_WORKDRIVE_FOLDER_ID],
  ].filter(([, item]) => !item).map(([name]) => name);
  return {
    hasClientId: Boolean(value.ZOHO_WORKDRIVE_CLIENT_ID),
    hasClientSecret: Boolean(value.ZOHO_WORKDRIVE_CLIENT_SECRET),
    hasRefreshToken: Boolean(value.ZOHO_WORKDRIVE_REFRESH_TOKEN),
    hasRootFolder: Boolean(value.ZOHO_WORKDRIVE_FOLDER_ID),
    rootFolderId: value.ZOHO_WORKDRIVE_FOLDER_ID || null,
    missingVariables,
  };
}

export async function testWorkDriveConnection(): Promise<WorkDriveConnectionResult> {
  const { value, token } = await accessToken();
  const response = await fetch(`${value.ZOHO_WORKDRIVE_API_BASE_URL}/workdrive/api/v1/files/${encodeURIComponent(value.ZOHO_WORKDRIVE_FOLDER_ID!)}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}`, Accept: "application/vnd.api+json" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null) as { data?: { id?: string; attributes?: { name?: string; type?: string } } } | null;
  if (response.status === 401) throw new ApiError(502, "WorkDrive authorization has expired or is invalid.", "WORKDRIVE_AUTH_FAILED");
  if (response.status === 403) throw new ApiError(502, "The WorkDrive account cannot access the configured root folder.", "WORKDRIVE_FOLDER_ACCESS_DENIED");
  if (response.status === 404) throw new ApiError(502, "The configured WorkDrive root folder was not found.", "WORKDRIVE_FOLDER_NOT_FOUND");
  if (!response.ok) throw new ApiError(502, "WorkDrive connection test failed.", "WORKDRIVE_CONNECTION_FAILED");
  const data = payload?.data;
  if (!data?.id) throw new ApiError(502, "WorkDrive returned an invalid root folder response.", "WORKDRIVE_CONNECTION_FAILED");
  return { folderId: data.id, folderName: text(data.attributes?.name) || "Configured root folder", folderType: text(data.attributes?.type) || "folder" };
}

export function sanitizeWorkDriveName(name: string, fallback = "lookbook") {
  const cleaned = name.normalize("NFKC").replace(/[^a-zA-Z0-9._ -]+/g, "-").replace(/[ -]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 180);
  return cleaned || fallback;
}

function safeName(name: string) {
  const cleaned = sanitizeWorkDriveName(name);
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned || "lookbook"}.pdf`;
}

export function chooseWorkDrivePdfName(displayName: string, existingNames: string[]) {
  const baseName = safeName(displayName);
  return existingNames.some((name) => name.trim().toLowerCase() === baseName.toLowerCase())
    ? `${baseName.slice(0, -4)}-${Date.now()}.pdf`
    : baseName;
}

function text(value: unknown) { return typeof value === "string" ? value : ""; }

async function workDriveJson(url: string, token: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers: { Authorization: `Zoho-oauthtoken ${token}`, Accept: "application/vnd.api+json", ...(init.headers || {}) }, cache: "no-store", signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(502, "WorkDrive folder operation failed.", "WORKDRIVE_FOLDER_FAILED");
  return body as { data?: Array<{ id?: string; type?: string; attributes?: { name?: string; type?: string } }> };
}

export async function getWorkDriveConnectionStatus(): Promise<WorkDriveConnectionStatus> {
  const value = getConfig();
  const configured = Boolean(value.ZOHO_WORKDRIVE_CLIENT_ID && value.ZOHO_WORKDRIVE_CLIENT_SECRET && value.ZOHO_WORKDRIVE_REFRESH_TOKEN && value.ZOHO_WORKDRIVE_FOLDER_ID);
  if (!configured) return { configured: false, connected: false, code: "NOT_CONFIGURED", message: "WorkDrive credentials and a root folder ID are not configured.", rootFolderIdConfigured: Boolean(value.ZOHO_WORKDRIVE_FOLDER_ID) };
  try {
    const result = await testWorkDriveConnection();
    const name = result.folderName;
    return { configured: true, connected: true, code: "CONNECTED", message: "WorkDrive is connected and the configured root folder is accessible.", rootFolderIdConfigured: true, ...(name ? { rootFolderName: name } : {}) };
  } catch (error) {
    const code = error instanceof ApiError && error.code === "WORKDRIVE_AUTH_FAILED" ? "AUTH_FAILED" : error instanceof ApiError && ["WORKDRIVE_FOLDER_FAILED", "WORKDRIVE_FOLDER_ACCESS_DENIED", "WORKDRIVE_FOLDER_NOT_FOUND"].includes(error.code) ? "FOLDER_FAILED" : "CONNECTION_FAILED";
    const message = code === "AUTH_FAILED" ? "WorkDrive authorization failed. Check the OAuth refresh token and client credentials." : code === "FOLDER_FAILED" ? "WorkDrive authorization succeeded, but the configured root folder could not be accessed." : "WorkDrive could not be reached. Check the server network and WorkDrive configuration.";
    return { configured: true, connected: false, code, message, rootFolderIdConfigured: true };
  }
}

async function ensureCollectionFolder(collection: string, token: string, value: ReturnType<typeof config>) {
  const root = value.ZOHO_WORKDRIVE_FOLDER_ID!;
  const desired = sanitizeWorkDriveName(collection, "Collection");
  const listed = await workDriveJson(`${value.ZOHO_WORKDRIVE_API_BASE_URL}/workdrive/api/v1/files/${encodeURIComponent(root)}/files?filter%5Btype%5D=folder&page%5Blimit%5D=50`, token);
  const existing = (listed.data || []).find((item) => item.id && text(item.attributes?.name).trim().toLowerCase() === desired.trim().toLowerCase() && (!item.attributes?.type || item.attributes.type.toLowerCase() === "folder"));
  if (existing?.id) return { rootFolderId: root, collectionFolderId: existing.id, collectionName: text(existing.attributes?.name) || desired };
  try {
    const created = await workDriveJson(`${value.ZOHO_WORKDRIVE_API_BASE_URL}/workdrive/api/v1/files`, token, { method: "POST", headers: { "Content-Type": "application/vnd.api+json" }, body: JSON.stringify({ data: { attributes: { parent_id: root, name: desired }, type: "files" } }) });
    const id = created.data?.[0]?.id || resourceId(created);
    if (id) return { rootFolderId: root, collectionFolderId: id, collectionName: desired };
  } catch { /* A concurrent uploader may have created the folder. Re-list once. */ }
  const retry = await workDriveJson(`${value.ZOHO_WORKDRIVE_API_BASE_URL}/workdrive/api/v1/files/${encodeURIComponent(root)}/files?filter%5Btype%5D=folder&page%5Blimit%5D=50`, token);
  const found = (retry.data || []).find((item) => item.id && text(item.attributes?.name).trim().toLowerCase() === desired.trim().toLowerCase());
  if (!found?.id) throw new ApiError(502, "WorkDrive collection folder could not be created.", "WORKDRIVE_FOLDER_FAILED");
  return { rootFolderId: root, collectionFolderId: found.id, collectionName: text(found.attributes?.name) || desired };
}

function resourceId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) for (const item of value) { const id = resourceId(item); if (id) return id; }
  else for (const [key, item] of Object.entries(value)) {
    if (["resource_id", "resourceId", "file_id", "fileId"].includes(key) && typeof item === "string" && item) return item;
    const id = resourceId(item); if (id) return id;
  }
  return null;
}

export async function uploadWorkDrivePdf(file: File, collection: string, displayName: string) {
  const { value, token } = await accessToken();
  const folder = await ensureCollectionFolder(collection, token, value);
  const baseName = safeName(displayName);
  const listed = await workDriveJson(`${value.ZOHO_WORKDRIVE_API_BASE_URL}/workdrive/api/v1/files/${encodeURIComponent(folder.collectionFolderId)}/files?filter%5Btype%5D=allfiles&page%5Blimit%5D=50`, token);
  const collision = (listed.data || []).some((item) => text(item.attributes?.name).trim().toLowerCase() === baseName.toLowerCase());
  const filename = chooseWorkDrivePdfName(displayName, collision ? [baseName] : []);
  const form = new FormData();
  form.set("parent_id", folder.collectionFolderId);
  form.set("filename", filename);
  form.set("override-name-exist", "false");
  form.set("content", file, filename);
  const response = await fetch(`${value.ZOHO_WORKDRIVE_UPLOAD_BASE_URL}/workdrive/api/v1/upload`, {
    method: "POST", headers: { Authorization: `Zoho-oauthtoken ${token}` }, body: form, cache: "no-store", signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(502, "WorkDrive PDF upload failed.", "WORKDRIVE_UPLOAD_FAILED");
  const id = resourceId(payload);
  if (!id) throw new ApiError(502, "WorkDrive upload returned no file ID.", "WORKDRIVE_UPLOAD_FAILED");
  return { id, name: filename, folderId: folder.collectionFolderId, rootFolderId: folder.rootFolderId, size: file.size };
}

export async function downloadWorkDrivePdf(fileId: string, request: Request) {
  const { value, token } = await accessToken();
  const headers = new Headers({ Authorization: `Zoho-oauthtoken ${token}`, Accept: "application/pdf, application/octet-stream;q=0.9" });
  for (const name of ["range", "if-range", "if-none-match", "if-modified-since"]) { const item = request.headers.get(name); if (item) headers.set(name, item); }
  const response = await fetch(`${value.ZOHO_WORKDRIVE_DOWNLOAD_BASE_URL}/v1/workdrive/download/${encodeURIComponent(fileId)}`, { headers, cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(30_000) });
  return response;
}
