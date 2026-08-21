import { Schema, model, models } from "mongoose";

const processingJobSchema = new Schema(
  {
    catalogId: { type: Schema.Types.ObjectId, ref: "Catalog", required: true, index: true },
    status: { type: String, enum: ["queued", "leased", "completed", "failed"], default: "queued", index: true },
    attempts: { type: Number, default: 0 },
    availableAt: { type: Date, default: Date.now, index: true },
    lockedUntil: Date,
    workerId: String,
    lastError: String,
  },
  { timestamps: true },
);

processingJobSchema.index({ catalogId: 1, status: 1 });
processingJobSchema.index({ status: 1, availableAt: 1, lockedUntil: 1 });

export const ProcessingJob = models.ProcessingJob || model("ProcessingJob", processingJobSchema);
