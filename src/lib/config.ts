import { z } from "zod";

const serverSchema = z.object({
  MONGODB_URI: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  STORAGE_DRIVER: z.enum(["s3", "local"]).default("s3"),
  LOCAL_STORAGE_ROOT: z.string().default("data/objects"),
  S3_ENDPOINT: z.string().url().optional().or(z.literal("")),
  S3_PUBLIC_ENDPOINT: z.string().url().optional().or(z.literal("")),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
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
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}
