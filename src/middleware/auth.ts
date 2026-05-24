import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "../config/auth";
import { AuthTokenPayload } from "../types/auth";

export interface AuthRequest extends Request {
  user?: AuthTokenPayload;
}

export const authenticateToken = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): any => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Authentication token is required" });
  }

  try {
    req.user = jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"] }) as AuthTokenPayload;
    next();
  } catch (error) {
    return res.status(403).json({ error: "Invalid or expired authentication token" });
  }
};

export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): any => {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }

  next();
};
