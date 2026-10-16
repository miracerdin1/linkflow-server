import mongoose from "mongoose";
import webpush from "web-push";
import Link from "../models/Link";
import PushSubscription from "../models/PushSubscription";
import Reminder from "../models/Reminder";

export interface PushPayload {
  title: string;
  body: string;
  /** External page to open when the notification is tapped. */
  url?: string;
  /** In-app route to open instead (e.g. "/recap"). */
  route?: string;
  /** Same tag replaces the earlier notification instead of stacking. */
  tag?: string;
}

const DISPATCH_INTERVAL_MS = 60 * 1000;
/** A reminder claimed this long ago without being finished is retried. */
const STALE_CLAIM_MS = 10 * 60 * 1000;
/** A weekly nudge that is later than this (server asleep) is skipped for the week. */
const WEEKLY_MAX_LATENESS_MS = 12 * 60 * 60 * 1000;
/** Turkey has stayed on UTC+3 all year since 2016. */
const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

let configured: boolean | null = null;

export const isPushConfigured = () => {
  if (configured !== null) return configured;

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    configured = false;
    return configured;
  }

  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configured = true;
  } catch (error) {
    console.error("[Push] Invalid VAPID settings:", error);
    configured = false;
  }

  return configured;
};

export const getVapidPublicKey = () => (isPushConfigured() ? process.env.VAPID_PUBLIC_KEY! : null);

/** Sends to every browser the user subscribed and drops the ones that expired. */
export const sendToUser = async (userId: string | mongoose.Types.ObjectId, payload: PushPayload) => {
  if (!isPushConfigured()) return 0;

  const subscriptions = await PushSubscription.find({ owner: userId });
  const results = await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: subscription.keys },
          JSON.stringify(payload),
          { TTL: DAY_MS / 1000, urgency: "normal" },
        );
        return true;
      } catch (error: any) {
        // 404/410: the user removed the app or revoked permission.
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await PushSubscription.deleteOne({ _id: subscription._id });
        } else {
          console.error("[Push] Send failed:", error?.statusCode, error?.body || error?.message);
        }
        return false;
      }
    }),
  );

  return results.filter(Boolean).length;
};

const dispatchDueReminders = async (now: Date) => {
  // Claim one at a time so the interval and the cron endpoint never send the same reminder.
  for (let i = 0; i < 200; i += 1) {
    const reminder = await Reminder.findOneAndUpdate(
      {
        fireAt: { $lte: now },
        $or: [{ claimedAt: null }, { claimedAt: { $lt: new Date(now.getTime() - STALE_CLAIM_MS) } }],
      },
      { $set: { claimedAt: now } },
      { sort: { fireAt: 1 }, returnDocument: "after" },
    );
    if (!reminder) return;

    const link = await Link.findById(reminder.link).select("url title");
    if (link) {
      await sendToUser(reminder.owner, {
        title: "Daha Sonra Oku 🔔",
        body: `Kaydettiğin "${link.title || "bağlantıya"}" göz atmak ister misin?`,
        url: link.url,
        tag: `reminder-${link._id}`,
      });
    }
    await Reminder.deleteOne({ _id: reminder._id });
  }
};

/** The most recent `weekday` (0 = Sunday) at `hour`:00 Istanbul time, as a real instant. */
const latestWeeklySlot = (now: Date, weekday: number, hour: number) => {
  const local = new Date(now.getTime() + ISTANBUL_OFFSET_MS);
  const daysBack = (local.getUTCDay() - weekday + 7) % 7;
  let slot = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour) - daysBack * DAY_MS;
  if (slot > local.getTime()) slot -= 7 * DAY_MS;

  return new Date(slot - ISTANBUL_OFFSET_MS);
};

const WEEKLY_NUDGES = [
  {
    flag: "recap",
    sentField: "lastRecapSentAt",
    weekday: 0,
    hour: 19,
    payload: {
      title: "Haftan hazır",
      body: "Bu hafta ne kaydettin, neyi unuttun? Bir dakikalık özetin seni bekliyor.",
      route: "/recap",
      tag: "weekly-recap",
    },
  },
  {
    flag: "smart",
    sentField: "lastSmartSentAt",
    weekday: 1,
    hour: 9,
    payload: {
      title: "Haftalık Akıllı Hatırlatıcı 🔔",
      body: "Kaydettiğin bağlantıları incelemek ve okuma listeni düzenlemek ister misin?",
      route: "/",
      tag: "weekly-smart",
    },
  },
] as const;

const dispatchWeeklyNudges = async (now: Date) => {
  for (const nudge of WEEKLY_NUDGES) {
    const slot = latestWeeklySlot(now, nudge.weekday, nudge.hour);
    if (now.getTime() - slot.getTime() > WEEKLY_MAX_LATENESS_MS) continue;

    const due = await PushSubscription.find({
      [nudge.flag]: true,
      $or: [{ [nudge.sentField]: null }, { [nudge.sentField]: { $lt: slot } }],
    }).select("owner endpoint keys");

    for (const subscription of due) {
      // Claim before sending; a parallel dispatcher that loses the race skips it.
      const claimed = await PushSubscription.updateOne(
        { _id: subscription._id, $or: [{ [nudge.sentField]: null }, { [nudge.sentField]: { $lt: slot } }] },
        { $set: { [nudge.sentField]: now } },
      );
      if (!claimed.modifiedCount) continue;

      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: subscription.keys },
          JSON.stringify(nudge.payload),
          { TTL: 6 * HOUR_MS / 1000, urgency: "normal" },
        );
      } catch (error: any) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await PushSubscription.deleteOne({ _id: subscription._id });
        } else {
          console.error("[Push] Weekly send failed:", error?.statusCode, error?.body || error?.message);
        }
      }
    }
  }
};

let dispatching = false;

/** Sends every reminder and weekly nudge that is due. Safe to call often. */
export const dispatchDuePush = async () => {
  if (!isPushConfigured() || mongoose.connection.readyState !== 1 || dispatching) return;

  dispatching = true;
  try {
    const now = new Date();
    await dispatchDueReminders(now);
    await dispatchWeeklyNudges(now);
  } catch (error) {
    console.error("[Push] Dispatch failed:", error);
  } finally {
    dispatching = false;
  }
};

/** Lets a reminder due within the next minute go out on time instead of on the next tick. */
export const dispatchAt = (fireAt: Date) => {
  const delay = fireAt.getTime() - Date.now();
  if (delay > DISPATCH_INTERVAL_MS) return;

  setTimeout(() => void dispatchDuePush(), Math.max(0, delay) + 500);
};

export const startPushScheduler = () => {
  if (!isPushConfigured()) {
    console.log("[Push] VAPID keys are not set. Web Push is disabled.");
    return;
  }

  setInterval(() => void dispatchDuePush(), DISPATCH_INTERVAL_MS);
  console.log("[Push] Scheduler started.");
};
