import { z } from "zod";

const serverSchema = z.object({
  MONGODB_URI: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  STORAGE_DRIVER: z.literal("local").default("local"),
  LOCAL_STORAGE_ROOT: z.string().default("data/objects"),
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
