import { z } from "zod";

const serverSchema = z.object({
  MONGODB_URI: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  APP_URL: z.string().url().optional().or(z.literal("")),
  SESSION_TTL_HOURS: z.coerce.number().positive().max(168).default(12),
  LOOKBOOK_STORAGE_DIR: z.string().trim().optional(),
  LOOKBOOK_MAX_UPLOAD_MB: z.coerce.number().positive().max(250).default(100),
  ZOHO_WORKDRIVE_API_BASE_URL: z.string().url().default("https://www.zohoapis.in"),
  ZOHO_WORKDRIVE_UPLOAD_BASE_URL: z.string().url().default("https://upload.zoho.in"),
  ZOHO_WORKDRIVE_DOWNLOAD_BASE_URL: z.string().url().default("https://download.zoho.in"),
  ZOHO_OAUTH_TOKEN_URL: z.string().url().default("https://accounts.zoho.in/oauth/v2/token"),
  ZOHO_WORKDRIVE_CLIENT_ID: z.string().optional(),
  ZOHO_WORKDRIVE_CLIENT_SECRET: z.string().optional(),
  ZOHO_WORKDRIVE_REFRESH_TOKEN: z.string().optional(),
  ZOHO_WORKDRIVE_FOLDER_ID: z.string().optional(),
  ZOHO_WORKDRIVE_MAX_UPLOAD_MB: z.coerce.number().positive().max(250).default(100),
});

export type ServerConfig = z.infer<typeof serverSchema>;
let cached: ServerConfig | undefined;

export function getConfig(): ServerConfig {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }
  if (process.env.NODE_ENV === "production") {
    if (!parsed.data.APP_URL) throw new Error("Missing required production configuration: APP_URL.");
    const origin = new URL(parsed.data.APP_URL);
    if (origin.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(origin.hostname)) {
      throw new Error("APP_URL must be an HTTPS public origin in production.");
    }
  }
  cached = parsed.data;
  return cached;
}

export function appUrl() {
  const configured = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    const origin = new URL(configured);
    const local = ["localhost", "127.0.0.1", "::1"].includes(origin.hostname);
    if (process.env.NODE_ENV === "production" && (origin.protocol !== "https:" || local)) {
      throw new Error("APP_URL must be an HTTPS public origin in production.");
    }
    return origin.toString().replace(/\/$/, "");
  }
  if (process.env.NODE_ENV === "production") throw new Error("APP_URL must be configured in production.");
  return "http://localhost:3000";
}
