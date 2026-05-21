import mongoose, { Document, Schema } from "mongoose";

export interface IFolder extends Document {
  name: string;
  icon?: string;
  color?: string;
  createdAt: Date;
}

const FolderSchema: Schema = new Schema({
  name: { type: String, required: true },
  icon: { type: String, default: "folder" },
  color: { type: String, default: "#6200ee" },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model<IFolder>("Folder", FolderSchema);
