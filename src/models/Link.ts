import mongoose, { Document, Schema } from "mongoose";

export interface ILink extends Document {
  url: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  category: "Video" | "Article" | "Product" | "Social" | "Other";
  tags: string[];
  createdAt: Date;
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
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model<ILink>("Link", LinkSchema);
