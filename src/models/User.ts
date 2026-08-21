import { Schema, model, models, type InferSchemaType } from "mongoose";

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["admin", "staff"], default: "staff", index: true },
    active: { type: Boolean, default: true },
    lastLoginAt: Date,
  },
  { timestamps: true },
);

export type IUser = InferSchemaType<typeof userSchema>;
export const User = models.User || model("User", userSchema);
