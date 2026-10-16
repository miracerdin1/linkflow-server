import mongoose, { Document, Schema } from "mongoose";

/**
 * A "read later" reminder for the PWA. Browsers cannot schedule a notification
 * on the device, so the server keeps the time and sends a Web Push when it comes.
 * One reminder per user and link, like the native app.
 */
export interface IReminder extends Document {
  owner: mongoose.Types.ObjectId;
  link: mongoose.Types.ObjectId;
  fireAt: Date;
  /** Set when a dispatcher claims it, so two dispatchers never send it twice. */
  claimedAt?: Date | null;
  createdAt: Date;
}

const ReminderSchema: Schema = new Schema({
  owner: { type: Schema.Types.ObjectId, ref: "User", required: true },
  link: { type: Schema.Types.ObjectId, ref: "Link", required: true },
  fireAt: { type: Date, required: true, index: true },
  claimedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

ReminderSchema.index({ owner: 1, link: 1 }, { unique: true });

export default mongoose.model<IReminder>("Reminder", ReminderSchema);
