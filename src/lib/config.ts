import { z } from "zod";

const serverSchema = z.object({
  MONGODB_URI: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  APP_URL: z.string().url().optional().or(z.literal("")),
  STORAGE_PROVIDER: z.enum(["local", "r2"]).optional(),
  STORAGE_DRIVER: z.enum(["local", "s3"]).optional(),
  LOCAL_STORAGE_ROOT: z.string().default("data/objects"),
  R2_ENDPOINT: z.string().url().optional().or(z.literal("")),
  R2_REGION: z.string().default("auto"),
  R2_BUCKET: z.string().optional().or(z.literal("")),
  R2_ACCESS_KEY_ID: z.string().optional().or(z.literal("")),
  R2_SECRET_ACCESS_KEY: z.string().optional().or(z.literal("")),
  R2_PUBLIC_BASE_URL: z.string().url().optional().or(z.literal("")),
  R2_HEALTHCHECK_KEY: z.string().optional().or(z.literal("")),
  R2_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("false"),
  S3_ENDPOINT: z.string().url().optional().or(z.literal("")),
  S3_REGION: z.string().optional().or(z.literal("")),
  S3_BUCKET: z.string().optional().or(z.literal("")),
  S3_ACCESS_KEY_ID: z.string().optional().or(z.literal("")),
  S3_SECRET_ACCESS_KEY: z.string().optional().or(z.literal("")),
  S3_PUBLIC_ENDPOINT: z.string().url().optional().or(z.literal("")),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("false"),
  STORAGE_PUBLIC_BASE_URL: z.string().url().optional().or(z.literal("")),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(604800).default(3600),
  MAX_PDF_SIZE_MB: z.coerce.number().positive().max(2048).default(250),
  MAX_COVER_SIZE_MB: z.coerce.number().positive().max(100).default(10),
  SESSION_TTL_HOURS: z.coerce.number().positive().max(168).default(12),
});

export type ServerConfig = z.infer<typeof serverSchema>;
export type StorageProvider = "local" | "r2";

let cached: ServerConfig | undefined;

export function getConfig(): ServerConfig {
  if (cached) return cached;

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server configuration: ${message}`);
  }

  if (process.env.NODE_ENV === "production") {
    if (parsed.data.STORAGE_PROVIDER !== "r2") {
      throw new Error("Production requires STORAGE_PROVIDER=r2. Refusing to use local filesystem storage.");
    }
    const missing = [
      ["APP_URL", parsed.data.APP_URL],
      ["R2_ENDPOINT", parsed.data.R2_ENDPOINT],
      ["R2_BUCKET", parsed.data.R2_BUCKET],
      ["R2_ACCESS_KEY_ID", parsed.data.R2_ACCESS_KEY_ID],
      ["R2_SECRET_ACCESS_KEY", parsed.data.R2_SECRET_ACCESS_KEY],
      ["R2_PUBLIC_BASE_URL", parsed.data.R2_PUBLIC_BASE_URL],
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) throw new Error(`Missing required production configuration: ${missing.join(", ")}.`);
    const origin = new URL(parsed.data.APP_URL!);
    if (origin.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(origin.hostname)) {
      throw new Error("APP_URL must be an HTTPS public origin in production.");
    }
  }
  cached = parsed.data;
  return cached;
}

export function storageProvider(config = getConfig()): StorageProvider {
  if (config.STORAGE_PROVIDER) return config.STORAGE_PROVIDER;
  if (process.env.NODE_ENV === "production") {
    throw new Error("Production requires STORAGE_PROVIDER=r2. Refusing to use local filesystem storage.");
  }
  return config.STORAGE_DRIVER === "s3" ? "r2" : "local";
}

export function appUrl() {
  const configured = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    const origin = new URL(configured);
    const isLocalOrigin = origin.hostname === "localhost" || origin.hostname === "127.0.0.1" || origin.hostname === "::1";
    if (process.env.NODE_ENV === "production" && (origin.protocol !== "https:" || isLocalOrigin)) {
      throw new Error("APP_URL must be an HTTPS public origin in production.");
    }
    return origin.toString().replace(/\/$/, "");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_URL must be configured in production.");
  }
  return "http://localhost:3000";
}
