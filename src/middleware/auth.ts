import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    email: string;
  };
}

// Generate a random 64-byte hex string once per server lifecycle if env is missing
const FALLBACK_SECRET = crypto.randomBytes(64).toString("hex");

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
