import mongoose, { Document, Schema } from "mongoose";

export interface ILink extends Document {
  url: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  category: "Video" | "Article" | "Product" | "Social" | "Other";
  tags: string[];
  folderId?: mongoose.Types.ObjectId;
  isPublic: boolean;
  owner?: mongoose.Types.ObjectId;
  createdAt: Date;
  isBroken?: boolean;
  lastCheckedAt?: Date;
  /** Last time the owner opened the link from the app. */
  openedAt?: Date;
  /** When the owner said "no longer needed" in the forgotten-links wheel. */
  dismissedAt?: Date;
}

const LinkSchema: Schema = new Schema({
  url: { type: String, required: true },
  title: { type: String },
  description: { type: String },
  imageUrl: { type: String },
  siteName: { type: String },
  category: {
    type: String,
    enum: ["Video", "Article", "Product", "Social", "Other"],
    default: "Other",
  },
  tags: [{ type: String }],
  folderId: { type: Schema.Types.ObjectId, ref: "Folder", default: null, index: true },
  isPublic: { type: Boolean, default: false },
  owner: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
  createdAt: { type: Date, default: Date.now },
  isBroken: { type: Boolean, default: false },
  lastCheckedAt: { type: Date },
  openedAt: { type: Date },
  dismissedAt: { type: Date },
});

export default mongoose.model<ILink>("Link", LinkSchema);
