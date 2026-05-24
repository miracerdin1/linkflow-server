import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth";
import User from "../models/User";
import Link from "../models/Link";
import Folder from "../models/Folder";

export const checkLinkQuota = async (req: AuthRequest, res: Response, next: NextFunction): Promise<any> => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Yetkisiz erişim" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı" });
    if (user.plan === "pro") return next();

    const linkCount = await Link.countDocuments({ owner: userId });
    if (linkCount >= 30) {
      return res.status(402).json({
        error: "Link limitine ulaştınız",
        code: "QUOTA_EXCEEDED",
        message: "Ücretsiz planda en fazla 30 adet link kaydedebilirsiniz. Sınırsız link kaydetmek için Pro plana geçin!"
      });
    }
    next();
  } catch (error) {
    console.error("Link quota check error:", error);
    res.status(500).json({ error: "Limit kontrolü sırasında bir hata oluştu" });
  }
};

export const checkFolderQuota = async (req: AuthRequest, res: Response, next: NextFunction): Promise<any> => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Yetkisiz erişim" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı" });
    if (user.plan === "pro") return next();

    const folderCount = await Folder.countDocuments({ owner: userId });
    if (folderCount >= 3) {
      return res.status(402).json({
        error: "Klasör limitine ulaştınız",
        code: "QUOTA_EXCEEDED",
        message: "Ücretsiz planda en fazla 3 adet klasör oluşturabilirsiniz. Sınırsız klasör için Pro plana geçin!"
      });
    }
    next();
  } catch (error) {
    console.error("Folder quota check error:", error);
    res.status(500).json({ error: "Limit kontrolü sırasında bir hata oluştu" });
  }
};

export const checkCollaboratorQuota = async (req: AuthRequest, res: Response, next: NextFunction): Promise<any> => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Yetkisiz erişim" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı" });
    if (user.plan === "pro") return next();

    return res.status(402).json({
      error: "Pro Plana Özel Özellik",
      code: "COLLABORATION_DISABLED",
      message: "Klasörlere ortak çalışan ekleme özelliği yalnızca Pro plan üyelerine özeldir. Pro plana yükselterek ortak klasörler oluşturun!"
    });
  } catch (error) {
    console.error("Collaborator quota check error:", error);
    res.status(500).json({ error: "Limit kontrolü sırasında bir hata oluştu" });
  }
};
