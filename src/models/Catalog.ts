import { Schema, model, models, type InferSchemaType } from "mongoose";

const catalogSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160, index: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    collectionName: { type: String, required: true, trim: true, maxlength: 120, index: true },
    season: { type: String, default: "", trim: true, maxlength: 80 },
    description: { type: String, default: "", maxlength: 2000 },
    status: {
      type: String,
      enum: ["draft", "imported", "published", "failed", "archived"],
      default: "draft",
      index: true,
    },
    sourcePdfUrl: { type: String, default: "" },
    // Kept for one-way migration of catalogs created before sourcePdfUrl.
    sourceUrl: { type: String, default: "" },
    sourceType: { type: String, enum: ["external_url", "workdrive", "local"], default: "external_url" },
    storageProvider: { type: String, enum: ["local", "workdrive", "external_url"] },
    storageKey: { type: String, trim: true, maxlength: 500 },
    storageContentType: { type: String, trim: true, maxlength: 100 },
    workdriveFileId: { type: String, trim: true },
    workdriveFileName: { type: String, trim: true, maxlength: 255 },
    workdriveFileType: { type: String, trim: true, maxlength: 80 },
    workdriveLink: { type: String, trim: true, maxlength: 2048 },
    workdriveFolderId: { type: String, trim: true },
    workdriveRootFolderId: { type: String, trim: true },
    uploadedAt: Date,
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
    sourceSize: Number,
    originalFilename: String,
    uploadRequestId: { type: String, trim: true, sparse: true },
    pageCount: { type: Number, default: 0 },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    processingProgress: { type: Number, default: 0 },
    processingMessage: { type: String, default: "" },
    processingError: { type: String, default: "" },
    failureCode: { type: String, enum: ["source_missing", "invalid_source"] },
    failureDetail: { type: String, default: "", maxlength: 2000 },
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
catalogSchema.index({ createdBy: 1, uploadRequestId: 1 }, { unique: true, sparse: true });

export type ICatalog = InferSchemaType<typeof catalogSchema>;
export const Catalog = models.Catalog || model("Catalog", catalogSchema);
