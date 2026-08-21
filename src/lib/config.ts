import { z } from "zod";

const serverSchema = z.object({
  MONGODB_URI: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  APP_URL: z.string().url().optional().or(z.literal("")),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  LOCAL_STORAGE_ROOT: z.string().default("data/objects"),
  R2_ENDPOINT: z.string().url().optional().or(z.literal("")),
  R2_REGION: z.string().default("auto"),
  R2_BUCKET: z.string().optional().or(z.literal("")),
  R2_ACCESS_KEY_ID: z.string().optional().or(z.literal("")),
  R2_SECRET_ACCESS_KEY: z.string().optional().or(z.literal("")),
  R2_PUBLIC_BASE_URL: z.string().url().optional().or(z.literal("")),
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

  cached = parsed.data;
  return cached;
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
