import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { getJwtSecret } from "../config/auth";
import { AuthTokenPayload } from "../types/auth";
import User from "../models/User";

export interface AuthRequest extends Request {
  user?: AuthTokenPayload;
}

export const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<any> => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Authentication token is required" });
  }

  let tokenPayload: AuthTokenPayload;

  try {
    tokenPayload = jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"] }) as AuthTokenPayload;
  } catch (error) {
    return res.status(403).json({ error: "Invalid or expired authentication token" });
  }

  if (!mongoose.Types.ObjectId.isValid(tokenPayload.id)) {
    return res.status(403).json({ error: "Invalid or expired authentication token" });
  }

  try {
    const userExists = await User.exists({ _id: tokenPayload.id });
    if (!userExists) {
      return res.status(401).json({ error: "User account no longer exists" });
    }
  } catch (error) {
    return res.status(500).json({ error: "Authentication check failed" });
  }

  req.user = tokenPayload;
  next();
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
