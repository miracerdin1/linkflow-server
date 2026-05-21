import express, { Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User";
import Profile from "../models/Profile";
import Folder from "../models/Folder";
import Link from "../models/Link";
import { authenticateToken, AuthRequest } from "../middleware/auth";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "linkflow-super-secret-key-12345";

// POST /api/auth/register
router.post("/register", async (req: any, res: Response): Promise<any> => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: "Lütfen tüm alanları doldurun" });
    }

    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();

    // Validate username format (no spaces, alphanumeric/underscores)
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(cleanUsername)) {
      return res.status(400).json({ error: "Kullanıcı adı 3-20 karakter uzunluğunda olmalı ve sadece harf, rakam ve alt çizgi içermelidir." });
    }

    // Check if user exists
    const existingUser = await User.findOne({
      $or: [{ username: cleanUsername }, { email: cleanEmail }],
    });

    if (existingUser) {
      if (existingUser.username === cleanUsername) {
        return res.status(400).json({ error: "Bu kullanıcı adı zaten alınmış" });
      }
      return res.status(400).json({ error: "Bu e-posta adresi zaten kullanımda" });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user
    const newUser = new User({
      username: cleanUsername,
      email: cleanEmail,
      passwordHash,
    });

    await newUser.save();

    // Check if there are orphaned folders/links and assign them to this FIRST user!
    const folderCount = await Folder.countDocuments({ owner: null });
    const linkCount = await Link.countDocuments({ owner: null });
    
    if (folderCount > 0 || linkCount > 0) {
      console.log(`[Migration] Assigning ${folderCount} folders and ${linkCount} links to first user: ${cleanUsername}`);
      await Folder.updateMany({ owner: null }, { owner: newUser._id });
      await Link.updateMany({ owner: null }, { owner: newUser._id });
    }

    // Check if there's an orphaned Profile, assign it. Otherwise create a new profile.
    let profile = await Profile.findOne({ owner: null });
    if (profile) {
      profile.owner = newUser._id as any;
      await profile.save();
    } else {
      profile = new Profile({
        name: cleanUsername,
        bio: "Kaydettiğim harika bağlantılar ve koleksiyonlar.",
        owner: newUser._id,
      });
      await profile.save();
    }

    // Create JWT Token
    const token = jwt.sign(
      { id: newUser._id, username: newUser.username, email: newUser.email },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.status(201).json({
      token,
      user: {
        id: newUser._id,
        username: newUser.username,
        email: newUser.email,
      },
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ error: "Sunucu hatası, lütfen tekrar deneyin" });
  }
});

// POST /api/auth/login
router.post("/login", async (req: any, res: Response): Promise<any> => {
  try {
    const { emailOrUsername, password } = req.body;

    if (!emailOrUsername || !password) {
      return res.status(400).json({ error: "Lütfen tüm alanları doldurun" });
    }

    const cleanInput = emailOrUsername.trim().toLowerCase();

    // Find user
    const user = await User.findOne({
      $or: [{ username: cleanInput }, { email: cleanInput }],
    });

    if (!user) {
      return res.status(400).json({ error: "Kullanıcı adı, e-posta veya şifre hatalı" });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ error: "Kullanıcı adı, e-posta veya şifre hatalı" });
    }

    // Ensure user has a profile (in case registration failed to make one)
    let profile = await Profile.findOne({ owner: user._id });
    if (!profile) {
      profile = new Profile({
        name: user.username,
        bio: "Kaydettiğim harika bağlantılar ve koleksiyonlar.",
        owner: user._id,
      });
      await profile.save();
    }

    // Create JWT Token
    const token = jwt.sign(
      { id: user._id, username: user.username, email: user.email },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Sunucu hatası, lütfen tekrar deneyin" });
  }
});

// GET /api/auth/me
router.get("/me", authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const user = await User.findById(req.user?.id).select("-passwordHash");
    if (!user) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı" });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
