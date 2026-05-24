import mongoose, { Document, Schema } from "mongoose";

export interface IUser extends Document {
  username: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  plan: "free" | "pro";
  role: "user" | "admin";
  subscriptionId?: string;
  subscriptionStatus?: "active" | "canceled" | "past_due" | "none";
  subscriptionExpiresAt?: Date;
}

const UserSchema: Schema = new Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  passwordHash: {
    type: String,
    required: true,
  },
  plan: {
    type: String,
    enum: ["free", "pro"],
    default: "free",
  },
  role: {
    type: String,
    enum: ["user", "admin"],
    default: "user",
  },
  subscriptionId: {
    type: String,
    default: null,
  },
  subscriptionStatus: {
    type: String,
    enum: ["active", "canceled", "past_due", "none"],
    default: "none",
  },
  subscriptionExpiresAt: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model<IUser>("User", UserSchema);
