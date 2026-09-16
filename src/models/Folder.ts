import mongoose, { Document, Schema } from "mongoose";

export interface IFolder extends Document {
  name: string;
  icon?: string;
  color?: string;
  isPublic: boolean;
  owner?: mongoose.Types.ObjectId;
  collaborators: mongoose.Types.ObjectId[];
  createdAt: Date;
}

const FolderSchema: Schema = new Schema({
  name: { type: String, required: true },
  icon: { type: String, default: "folder" },
  color: { type: String, default: "#6200ee" },
  isPublic: { type: Boolean, default: false },
  owner: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
  collaborators: [{ type: Schema.Types.ObjectId, ref: "User", default: [], index: true }],
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model<IFolder>("Folder", FolderSchema);
