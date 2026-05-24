import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    email: string;
  };
}

// Use a static fallback for development so tokens survive restarts and module reloads.
const FALLBACK_SECRET = "dev-fallback-secret-linkflow-do-not-use-in-prod";
if (!process.env.JWT_SECRET) {
  console.warn("⚠️  UYARI: .env dosyasında JWT_SECRET bulunamadı! Geliştirme (fallback) şifresi kullanılıyor. Üretim ortamında KESİNLİKLE bir JWT_SECRET tanımlayın.");
}

export const authenticateToken = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): any => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Giriş yapmanız gerekmektedir (Yetkilendirme anahtarı bulunamadı)" });
  }

  try {
    const JWT_SECRET = process.env.JWT_SECRET || FALLBACK_SECRET;
    const decoded = jwt.verify(token, JWT_SECRET) as {
      id: string;
      username: string;
      email: string;
    };
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: "Oturum süreniz dolmuş veya geçersiz bir anahtar kullandınız" });
  }
};
