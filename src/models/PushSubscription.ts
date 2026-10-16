import mongoose, { Document, Schema } from "mongoose";

/** One browser (an installed PWA) that agreed to receive Web Push for a user. */
export interface IPushSubscription extends Document {
  owner: mongoose.Types.ObjectId;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** Sunday 19:00 weekly recap. On by default, like the native app. */
  recap: boolean;
  /** Monday 09:00 "review your reading list" nudge. */
  smart: boolean;
  lastRecapSentAt?: Date | null;
  lastSmartSentAt?: Date | null;
  createdAt: Date;
}

const PushSubscriptionSchema: Schema = new Schema({
  owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  endpoint: { type: String, required: true, unique: true },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
  },
  recap: { type: Boolean, default: true },
  smart: { type: Boolean, default: false },
  // Start from "now" so a browser subscribed after this week's slot does not
  // get that week's nudge the moment it subscribes.
  lastRecapSentAt: { type: Date, default: Date.now },
  lastSmartSentAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model<IPushSubscription>("PushSubscription", PushSubscriptionSchema);
