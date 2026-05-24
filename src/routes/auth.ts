import express, { Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User";
import Profile from "../models/Profile";
import { getJwtSecret } from "../config/auth";
import { authenticateToken, AuthRequest } from "../middleware/auth";

const router = express.Router();
const PASSWORD_MIN_LENGTH = 8;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const createToken = (user: { _id: unknown; username: string; email: string }) =>
  jwt.sign(
    { id: user._id, username: user.username, email: user.email },
    getJwtSecret(),
    { expiresIn: "30d", algorithm: "HS256" },
  );

// POST /api/auth/register
router.post("/register", async (req: any, res: Response): Promise<any> => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: "Lutfen tum alanlari doldurun" });
    }

    const cleanUsername = String(username).trim().toLowerCase();
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPassword = String(password);
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;

    if (!usernameRegex.test(cleanUsername)) {
      return res.status(400).json({ error: "Kullanici adi 3-20 karakter olmali ve sadece harf, rakam ve alt cizgi icermelidir." });
    }

    if (!EMAIL_REGEX.test(cleanEmail)) {
      return res.status(400).json({ error: "Lutfen gecerli bir e-posta adresi girin." });
    }

    if (cleanPassword.length < PASSWORD_MIN_LENGTH) {
      return res.status(400).json({ error: `Sifre en az ${PASSWORD_MIN_LENGTH} karakter olmalidir.` });
    }

    const existingUser = await User.findOne({
      $or: [{ username: cleanUsername }, { email: cleanEmail }],
    });

    if (existingUser) {
      if (existingUser.username === cleanUsername) {
        return res.status(400).json({ error: "Bu kullanici adi zaten alinmis" });
      }
      return res.status(400).json({ error: "Bu e-posta adresi zaten kullanimda" });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(cleanPassword, salt);
    const newUser = new User({
      username: cleanUsername,
      email: cleanEmail,
      passwordHash,
    });

    await newUser.save();

    let profile = await Profile.findOne({ owner: null });
    if (profile) {
      profile.owner = newUser._id as any;
      await profile.save();
    } else {
      profile = new Profile({
        name: cleanUsername,
        bio: "Kaydettigim harika baglantilar ve koleksiyonlar.",
        owner: newUser._id,
      });
      await profile.save();
    }

    res.status(201).json({
      token: createToken(newUser),
      user: {
        id: newUser._id,
        username: newUser.username,
        email: newUser.email,
      },
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ error: "Sunucu hatasi, lutfen tekrar deneyin" });
  }
});

// POST /api/auth/login
router.post("/login", async (req: any, res: Response): Promise<any> => {
  try {
    const { emailOrUsername, password } = req.body;

    if (!emailOrUsername || !password) {
      return res.status(400).json({ error: "Lutfen tum alanlari doldurun" });
    }

    const cleanInput = String(emailOrUsername).trim().toLowerCase();
    const cleanPassword = String(password);
    const user = await User.findOne({
      $or: [{ username: cleanInput }, { email: cleanInput }],
    });

    if (!user) {
      return res.status(400).json({ error: "Kullanici adi, e-posta veya sifre hatali" });
    }

    const isMatch = await bcrypt.compare(cleanPassword, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ error: "Kullanici adi, e-posta veya sifre hatali" });
    }

    let profile = await Profile.findOne({ owner: user._id });
    if (!profile) {
      profile = new Profile({
        name: user.username,
        bio: "Kaydettigim harika baglantilar ve koleksiyonlar.",
        owner: user._id,
      });
      await profile.save();
    }

    res.json({
      token: createToken(user),
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Sunucu hatasi, lutfen tekrar deneyin" });
  }
});

// GET /api/auth/me
router.get("/me", authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const user = await User.findById(req.user?.id).select("-passwordHash");
    if (!user) {
      return res.status(404).json({ error: "Kullanici bulunamadi" });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: "Sunucu hatasi" });
  }
});

export default router;
