import { Schema, model, models } from "mongoose";

const catalogEventSchema = new Schema(
  {
    catalogId: { type: Schema.Types.ObjectId, ref: "Catalog", required: true, index: true },
    type: { type: String, enum: ["view", "page_view", "share", "download"], required: true, index: true },
    page: Number,
    sessionId: { type: String, maxlength: 100 },
    referrer: { type: String, maxlength: 500 },
    userAgent: { type: String, maxlength: 500 },
    createdAt: { type: Date, default: Date.now, expires: "180d", index: true },
  },
  { versionKey: false },
);

catalogEventSchema.index({ catalogId: 1, type: 1, createdAt: -1 });

export const CatalogEvent = models.CatalogEvent || model("CatalogEvent", catalogEventSchema);
