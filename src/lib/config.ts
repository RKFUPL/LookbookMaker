import { isAbsolute, resolve } from "node:path";
import { z } from "zod";

const PRODUCTION_STORAGE_ROOT = "/var/data/objects";

const serverSchema = z.object({
  MONGODB_URI: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  APP_URL: z.string().url().optional().or(z.literal("")),
  LOCAL_STORAGE_ROOT: z.string().optional().or(z.literal("")),
  MAX_PDF_SIZE_MB: z.coerce.number().positive().max(2048).default(250),
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

export function catalogStorageRoot(config = getConfig()) {
  const configured = config.LOCAL_STORAGE_ROOT?.trim()
    || (process.env.NODE_ENV === "production" ? PRODUCTION_STORAGE_ROOT : "data/objects");
  return isAbsolute(configured)
    ? resolve(/* turbopackIgnore: true */ configured)
    : resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

export function requiredProductionStorageRoot() {
  return PRODUCTION_STORAGE_ROOT;
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
  if (process.env.NODE_ENV === "production") throw new Error("APP_URL must be configured in production.");
  return "http://localhost:3000";
}
