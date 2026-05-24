import express, { Response } from "express";
import Stripe from "stripe";
import User from "../models/User";
import { authenticateToken, AuthRequest } from "../middleware/auth";
// @ts-ignore - Iyzipay doesn't have official types
import Iyzipay from "iyzipay";

const router = express.Router();

const iyzipay = new Iyzipay({
  apiKey: process.env.IYZIPAY_API_KEY || "sandbox-dummy-api-key",
  secretKey: process.env.IYZIPAY_SECRET_KEY || "sandbox-dummy-secret-key",
  uri: process.env.IYZIPAY_URI || "https://sandbox-api.iyzipay.com"
});

// POST /api/payments/subscribe - Iyzico Checkout Form Oluşturma
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

    if (!process.env.IYZIPAY_API_KEY) {
      return res.status(500).json({ 
        message: "Iyzico ayarları yapılandırılmamış. Lütfen sunucuya IYZIPAY_API_KEY ekleyin." 
      });
    }

    const { plan, returnUrl } = req.body;
    const price = plan === "monthly" ? "99.00" : "699.00";
    const planName = plan === "monthly" ? "LinkFlow Pro (Aylık)" : "LinkFlow Pro (Yıllık)";

    // Sunucunun base URL'i
    const serverUrl = req.protocol + "://" + req.get("host");
    const callbackUrl = `${serverUrl}/api/payments/iyzico-callback?userId=${userId}&returnUrl=${encodeURIComponent(returnUrl || "linkflow://")}`;

    const request = {
      locale: Iyzipay.LOCALE.TR,
      conversationId: userId,
      price: price,
      paidPrice: price,
      currency: Iyzipay.CURRENCY.TRY,
      basketId: "B67832",
      paymentGroup: Iyzipay.PAYMENT_GROUP.SUBSCRIPTION, // Abonelik tarzı satışı ifade eder (ama tek çekim olacak)
      callbackUrl: callbackUrl,
      enabledInstallments: [1],
      buyer: {
        id: userId,
        name: user.username || "John",
        surname: "Doe", // Gerçek sistemde kullanıcıdan ad soyad alınmalıdır
        gsmNumber: "+905300000000", // Gerçek sistemde kullanıcıdan alınmalıdır
        email: user.email,
        identityNumber: "11111111111", // Gerçek sistemde kullanıcıdan alınmalıdır
        registrationAddress: "Nidakule Göztepe, Merdivenköy Mah. Bora Sok. No:1", // Mock adres
        ip: req.ip || "85.34.78.112",
        city: "Istanbul",
        country: "Turkey",
        zipCode: "34732"
      },
      shippingAddress: {
        contactName: user.username || "John Doe",
        city: "Istanbul",
        country: "Turkey",
        address: "Nidakule Göztepe, Merdivenköy Mah. Bora Sok. No:1", // Mock adres
        zipCode: "34732"
      },
      billingAddress: {
        contactName: user.username || "John Doe",
        city: "Istanbul",
        country: "Turkey",
        address: "Nidakule Göztepe, Merdivenköy Mah. Bora Sok. No:1", // Mock adres
        zipCode: "34732"
      },
      basketItems: [
        {
          id: plan === "monthly" ? "PRO_MONTHLY" : "PRO_YEARLY",
          name: planName,
          category1: "Software",
          category2: "Subscription",
          itemType: Iyzipay.BASKET_ITEM_TYPE.VIRTUAL,
          price: price
        }
      ]
    };

    iyzipay.checkoutFormInitialize.create(request, (err: any, result: any) => {
      if (err) {
        console.error("Iyzico form init error:", err);
        return res.status(500).json({ message: "Ödeme sistemiyle iletişim kurulamadı." });
      }
      
      if (result.status === "success") {
        res.json({
          url: result.paymentPageUrl,
          token: result.token
        });
      } else {
        res.status(400).json({ message: result.errorMessage || "Ödeme formu oluşturulamadı." });
      }
    });

  } catch (error: any) {
    console.error("Iyzico session creation error:", error);
    res.status(500).json({ message: error.message || "Ödeme oturumu oluşturulurken bir hata oluştu" });
  }
});

// POST /api/payments/iyzico-callback - Iyzico Ödeme Sonucu Yakalayıcı (Webhook / Callback)
// Bu rotaya Iyzico, kullanıcı ödemeyi bitirdiğinde POST atarak geri döner.
router.post("/iyzico-callback", async (req: express.Request, res: Response): Promise<any> => {
  try {
    const token = req.body.token;
    const { userId, returnUrl } = req.query;

    if (!token || !userId) {
      return res.status(400).send("Geçersiz istek.");
    }

    // Token ile sonucu doğrula
    iyzipay.checkoutForm.retrieve({
      locale: Iyzipay.LOCALE.TR,
      conversationId: userId as string,
      token: token
    }, async (err: any, result: any) => {
      if (err) {
        console.error("Iyzico retrieve error:", err);
        return res.redirect((returnUrl as string) + "?status=error");
      }

      if (result.paymentStatus === "SUCCESS") {
        // Ödeme başarılı, kullanıcıyı PRO yap!
        await User.findByIdAndUpdate(userId, {
          plan: "pro",
          subscriptionStatus: "active",
          subscriptionId: result.paymentId // Iyzico'nun paymentId'sini abonelik ID'si gibi saklıyoruz
        });
        
        console.log(`[Iyzico] User ${userId} upgraded to PRO. Payment ID: ${result.paymentId}`);
        return res.redirect((returnUrl as string) + "?status=success");
      } else {
        // Ödeme başarısız
        console.log(`[Iyzico] Payment failed for user ${userId}. Error: ${result.errorMessage}`);
        return res.redirect((returnUrl as string) + "?status=cancel");
      }
    });

  } catch (err: any) {
    console.error("Iyzico callback processing error:", err.message);
    const returnUrl = req.query.returnUrl as string;
    if (returnUrl) {
      return res.redirect(returnUrl + "?status=error");
    }
    res.status(500).send("Sistem hatası");
  }
});

export default router;
