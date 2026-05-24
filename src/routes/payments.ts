import express, { Response } from "express";
import Stripe from "stripe";
import User from "../models/User";
import { authenticateToken, AuthRequest } from "../middleware/auth";

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_mock_fallback", {
  apiVersion: "2024-06-20",
});

// POST /api/payments/subscribe - Stripe Checkout Session Oluşturma
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

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ 
        message: "Stripe ayarları yapılandırılmamış. Lütfen sunucuya STRIPE_SECRET_KEY ekleyin." 
      });
    }

    const { plan, returnUrl } = req.body;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      customer_email: user.email,
      client_reference_id: userId,
      line_items: [
        {
          price_data: {
            currency: "try",
            recurring: { interval: plan === "monthly" ? "month" : "year" },
            product_data: {
              name: "LinkFlow Pro",
              description: plan === "monthly" ? "Aylık Sınırsız Erişim" : "Yıllık Sınırsız Erişim",
            },
            unit_amount: plan === "monthly" ? 9900 : 69900,
          },
          quantity: 1,
        },
      ],
      success_url: returnUrl ? `${returnUrl}?status=success` : "http://localhost:8081?status=success",
      cancel_url: returnUrl ? `${returnUrl}?status=cancel` : "http://localhost:8081?status=cancel",
    });

    res.json({
      url: session.url,
      sessionId: session.id,
    });
  } catch (error: any) {
    console.error("Stripe session creation error:", error);
    res.status(500).json({ message: error.message || "Ödeme oturumu oluşturulurken bir hata oluştu" });
  }
});

// POST /api/payments/cancel - Abonelik iptali
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

    if (user.subscriptionId && user.subscriptionId.startsWith("sub_")) {
      await stripe.subscriptions.cancel(user.subscriptionId);
    }

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
  } catch (error: any) {
    console.error("Subscription cancel error:", error);
    res.status(500).json({ message: error.message || "Abonelik iptali sırasında bir hata oluştu" });
  }
});

// POST /api/payments/webhook - Stripe Webhook Handler
router.post("/webhook", express.raw({ type: "application/json" }), async (req: express.Request, res: Response): Promise<any> => {
  const sig = req.headers["stripe-signature"] as string;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET || "");
  } catch (err: any) {
    console.error("Webhook Signature Error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id;
      
      if (userId) {
        await User.findByIdAndUpdate(userId, {
          plan: "pro",
          subscriptionStatus: "active",
          subscriptionId: session.subscription as string,
        });
        console.log(`[Stripe Webhook] User ${userId} upgraded to PRO.`);
      }
    }
    
    // Check if subscription deleted
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      await User.findOneAndUpdate(
        { subscriptionId: subscription.id }, 
        {
          plan: "free",
          subscriptionStatus: "canceled",
          subscriptionId: undefined,
          subscriptionExpiresAt: undefined
        }
      );
      console.log(`[Stripe Webhook] Subscription ${subscription.id} canceled.`);
    }

    res.json({ received: true });
  } catch (err: any) {
    console.error("Webhook processing error:", err.message);
    res.status(500).send("Webhook processing error");
  }
});

export default router;
