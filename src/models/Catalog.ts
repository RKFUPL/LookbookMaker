import { Schema, model, models, type InferSchemaType } from "mongoose";

const productLinkSchema = new Schema(
  {
    sku: { type: String, required: true },
    label: { type: String, default: "View product" },
    href: { type: String, required: true },
    x: Number,
    y: Number,
    width: Number,
    height: Number,
  },
  { _id: false },
);

const pageSchema = new Schema(
  {
    page: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    // imageKey remains for catalogs processed by the original pipeline.
    imageKey: String,
    thumbnailKey: { type: String, required: true },
    mediumKey: String,
    largeKey: String,
    productLinks: { type: [productLinkSchema], default: [] },
  },
  { _id: false },
);

const catalogSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160, index: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    collectionName: { type: String, required: true, trim: true, maxlength: 120, index: true },
    season: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: "", maxlength: 2000 },
    status: {
      type: String,
      enum: ["draft", "uploading", "processing", "ready", "published", "archived", "error"],
      default: "draft",
      index: true,
    },
    sourceKey: String,
    sourceUrl: String,
    sourceSize: Number,
    sourceEtag: String,
    sourceContentType: String,
    originalFilename: String,
    pendingSourceKey: { type: String, select: false },
    pendingSourceSize: { type: Number, select: false },
    pendingSourceContentType: { type: String, select: false },
    pendingSourceFilename: { type: String, select: false },
    coverImageKey: String,
    coverContentType: String,
    pendingCoverKey: { type: String, select: false },
    pendingCoverSize: { type: Number, select: false },
    pendingCoverContentType: { type: String, select: false },
    pageCount: { type: Number, default: 0 },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    assetVersion: String,
    pages: { type: [pageSchema], default: [] },
    processingProgress: { type: Number, default: 0 },
    processingMessage: { type: String, default: "" },
    processingError: { type: String, default: "" },
    allowDownload: { type: Boolean, default: true },
    showBackButton: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    publishedAt: Date,
    views: { type: Number, default: 0 },
  },
  { timestamps: true, optimisticConcurrency: true },
);

catalogSchema.index({ status: 1, updatedAt: -1 });
catalogSchema.index({ collectionName: 1, season: 1 });
catalogSchema.index({ title: "text", collectionName: "text", season: "text" });

export type ICatalog = InferSchemaType<typeof catalogSchema>;
export const Catalog = models.Catalog || model("Catalog", catalogSchema);
