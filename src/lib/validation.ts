import { z } from "zod";

export const catalogCreateSchema = z.object({
  title: z.string().trim().min(2).max(160),
  collection: z.string().trim().min(1).max(120),
  season: z.string().trim().max(80).default(""),
  description: z.string().trim().max(2000).default(""),
  pdfUrl: z.string().trim().url().max(2048),
  allowDownload: z.boolean().default(true),
  showBackButton: z.boolean().default(false),
});

export const catalogUpdateSchema = catalogCreateSchema.partial().extend({
  status: z.enum(["draft", "imported", "archived"]).optional(),
});
