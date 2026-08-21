import { z } from "zod";

export const catalogCreateSchema = z.object({
  title: z.string().trim().min(2).max(160),
  collection: z.string().trim().min(1).max(120),
  season: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2000).default(""),
  allowDownload: z.boolean().default(true),
  showBackButton: z.boolean().default(false),
});

export const catalogUpdateSchema = catalogCreateSchema.partial().extend({
  status: z.enum(["draft", "ready", "archived"]).optional(),
});

export const uploadInitSchema = z.object({
  kind: z.enum(["pdf", "cover"]),
  filename: z.string().min(1).max(255),
  size: z.number().int().positive(),
  contentType: z.string().min(1).max(100),
});
