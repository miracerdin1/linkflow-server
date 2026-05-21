import mongoose, { Document, Schema } from "mongoose";

export interface IProfile extends Document {
  name: string;
  bio: string;
  avatarUrl?: string;
  theme: string;
  owner?: mongoose.Types.ObjectId;
  updatedAt: Date;
}

const ProfileSchema: Schema = new Schema({
  name: { type: String, default: "LinkFlow Kullanıcısı" },
  bio: { type: String, default: "Kaydettiğim harika bağlantılar ve koleksiyonlar." },
  avatarUrl: { type: String, default: "" },
  theme: { type: String, default: "purple-dark" },
  owner: { type: Schema.Types.ObjectId, ref: "User", default: null, unique: true, sparse: true },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model<IProfile>("Profile", ProfileSchema);
