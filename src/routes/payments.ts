import express, { Response } from "express";
import User from "../models/User";
import { authenticateToken, AuthRequest } from "../middleware/auth";

const router = express.Router();

// POST /api/payments/subscribe - Simüle edilmiş Pro plana yükseltme
router.post("/subscribe", authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Yetkisiz erişim" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" });
    }

    // Pro plana yükselt
    user.plan = "pro";
    user.subscriptionStatus = "active";
    user.subscriptionId = "sub_mock_" + Math.random().toString(36).substring(2, 15);
    user.subscriptionExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 yıl sonra

    await user.save();

    res.json({
      message: "Pro plana başarıyla yükseltildiniz!",
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        plan: user.plan,
        subscriptionStatus: user.subscriptionStatus,
        subscriptionExpiresAt: user.subscriptionExpiresAt
      }
    });
  } catch (error) {
    console.error("Subscription simulation error:", error);
    res.status(500).json({ error: "Abonelik yükseltmesi sırasında bir hata oluştu" });
  }
});

// POST /api/payments/cancel - Simüle edilmiş abonelik iptali (Free plana dönüş)
router.post("/cancel", authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Yetkisiz erişim" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" });
    }

    // Ücretsiz plana döndür
    user.plan = "free";
    user.subscriptionStatus = "none";
    user.subscriptionId = undefined;
    user.subscriptionExpiresAt = undefined;

    await user.save();

    res.json({
      message: "Aboneliğiniz iptal edildi, ücretsiz plana döndünüz.",
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        plan: user.plan,
        subscriptionStatus: user.subscriptionStatus
      }
    });
  } catch (error) {
    console.error("Subscription cancel simulation error:", error);
    res.status(500).json({ error: "Abonelik iptali sırasında bir hata oluştu" });
  }
});

export default router;
