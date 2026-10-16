import crypto from "crypto";
import express, { Request, Response } from "express";
import mongoose from "mongoose";
import rateLimit from "express-rate-limit";
import Folder from "../models/Folder";
import Link from "../models/Link";
import PushSubscription from "../models/PushSubscription";
import Reminder from "../models/Reminder";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import { dispatchAt, dispatchDuePush, getVapidPublicKey } from "../services/webPush";

const router = express.Router();

const MAX_REMINDER_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;

// The server POSTs to whatever endpoint is stored, so only the browsers' own
// push services are accepted; anything else would let a caller aim requests
// at arbitrary hosts.
const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com",
  "push.apple.com",
  "push.services.mozilla.com",
  "notify.windows.com",
];

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { error: "Çok fazla istek gönderildi. Lütfen daha sonra tekrar deneyin." },
});

const parseEndpoint = (value: unknown) => {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const allowed = PUSH_SERVICE_HOSTS.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );
    return url.protocol === "https:" && allowed ? url.href : null;
  } catch {
    return null;
  }
};

const isKey = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 512;

const optionalFlag = (value: unknown) => (typeof value === "boolean" ? value : undefined);

const canSeeLink = async (linkId: string, userId: string) => {
  const link = await Link.findById(linkId).select("owner folderId");
  if (!link) return false;
  if (link.owner?.toString() === userId) return true;
  if (!link.folderId) return false;

  return !!(await Folder.exists({
    _id: link.folderId,
    $or: [{ owner: userId }, { collaborators: userId }],
  }));
};

// GET /api/push/public-key - VAPID key the browser needs to subscribe
router.get("/public-key", (req: Request, res: Response): any => {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    return res.status(503).json({ error: "Bildirimler sunucuda henüz ayarlanmadı." });
  }

  res.json({ publicKey });
});

// POST /api/push/subscriptions - Save (or move to this user) a browser subscription
router.post("/subscriptions", authenticateToken, writeLimiter, async (req: AuthRequest, res: Response): Promise<any> => {
  const endpoint = parseEndpoint(req.body?.subscription?.endpoint);
  const keys = req.body?.subscription?.keys;
  if (!endpoint || !isKey(keys?.p256dh) || !isKey(keys?.auth)) {
    return res.status(400).json({ error: "Geçersiz bildirim aboneliği" });
  }

  const recap = optionalFlag(req.body?.recap);
  const smart = optionalFlag(req.body?.smart);

  try {
    const subscription = await PushSubscription.findOneAndUpdate(
      { endpoint },
      {
        $set: {
          owner: req.user!.id,
          keys: { p256dh: keys.p256dh, auth: keys.auth },
          ...(recap !== undefined && { recap }),
          ...(smart !== undefined && { smart }),
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );

    res.json({ recap: subscription.recap, smart: subscription.smart });
  } catch (error) {
    console.error("Error saving push subscription:", error);
    res.status(500).json({ error: "Bildirim aboneliği kaydedilemedi" });
  }
});

// GET /api/push/subscriptions/current?endpoint= - Settings of this browser
router.get("/subscriptions/current", authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const endpoint = parseEndpoint(req.query.endpoint);
  if (!endpoint) {
    return res.status(400).json({ error: "Geçersiz bildirim aboneliği" });
  }

  try {
    const subscription = await PushSubscription.findOne({ endpoint, owner: req.user!.id }).select("recap smart");
    if (!subscription) {
      return res.status(404).json({ error: "Abonelik bulunamadı" });
    }

    res.json({ recap: subscription.recap, smart: subscription.smart });
  } catch (error) {
    res.status(500).json({ error: "Bildirim ayarları alınamadı" });
  }
});

// DELETE /api/push/subscriptions - Stop pushing to this browser (logout)
router.delete("/subscriptions", authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const endpoint = parseEndpoint(req.body?.endpoint);
  if (!endpoint) {
    return res.status(400).json({ error: "Geçersiz bildirim aboneliği" });
  }

  try {
    await PushSubscription.deleteOne({ endpoint, owner: req.user!.id });
    res.json({ deleted: true });
  } catch (error) {
    res.status(500).json({ error: "Bildirim aboneliği silinemedi" });
  }
});

// GET /api/push/reminders - Pending reminders of the user
router.get("/reminders", authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const reminders = await Reminder.find({ owner: req.user!.id }).select("link fireAt").sort({ fireAt: 1 });
    res.json(reminders.map((reminder) => ({ linkId: reminder.link, fireAt: reminder.fireAt })));
  } catch (error) {
    res.status(500).json({ error: "Hatırlatıcılar alınamadı" });
  }
});

// PUT /api/push/reminders/:linkId - Set (or move) the reminder of a link
router.put("/reminders/:linkId", authenticateToken, writeLimiter, async (req: AuthRequest, res: Response): Promise<any> => {
  const linkId = req.params.linkId as string;
  const fireAt = new Date(req.body?.fireAt);
  const delay = fireAt.getTime() - Date.now();
  if (Number.isNaN(delay) || delay < -60 * 1000 || delay > MAX_REMINDER_AHEAD_MS) {
    return res.status(400).json({ error: "Lütfen gelecekteki bir tarih ve saat seçin." });
  }
  if (!mongoose.isValidObjectId(linkId)) {
    return res.status(404).json({ error: "Link bulunamadı" });
  }

  try {
    if (!(await canSeeLink(linkId, req.user!.id))) {
      return res.status(404).json({ error: "Link bulunamadı" });
    }

    await Reminder.findOneAndUpdate(
      { owner: req.user!.id, link: linkId },
      { $set: { fireAt, claimedAt: null } },
      { upsert: true, setDefaultsOnInsert: true },
    );
    dispatchAt(fireAt);

    res.json({ linkId, fireAt });
  } catch (error) {
    console.error("Error saving reminder:", error);
    res.status(500).json({ error: "Hatırlatıcı kaydedilemedi" });
  }
});

// DELETE /api/push/reminders/:linkId
router.delete("/reminders/:linkId", authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const linkId = req.params.linkId as string;
  if (!mongoose.isValidObjectId(linkId)) {
    return res.status(404).json({ error: "Hatırlatıcı bulunamadı" });
  }

  try {
    await Reminder.deleteOne({ owner: req.user!.id, link: linkId });
    res.json({ deleted: true });
  } catch (error) {
    res.status(500).json({ error: "Hatırlatıcı silinemedi" });
  }
});

const isCronAuthorized = (header: string | undefined) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;

  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

// POST /api/push/dispatch - Called by an external cron. On Render's free plan
// this also wakes the server, which otherwise sleeps through reminder times.
router.post("/dispatch", async (req: Request, res: Response): Promise<any> => {
  if (!process.env.CRON_SECRET) {
    return res.status(503).json({ error: "Cron is not configured." });
  }
  if (!isCronAuthorized(req.headers.authorization)) {
    return res.status(401).json({ error: "Invalid cron authorization." });
  }

  await dispatchDuePush();
  res.json({ ok: true });
});

export default router;
