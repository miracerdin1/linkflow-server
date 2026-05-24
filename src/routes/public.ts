import escapeHtml from "escape-html";
import express, { Response } from "express";
import User from "../models/User";
import Folder from "../models/Folder";
import Link from "../models/Link";
import Profile from "../models/Profile";
import { authenticateToken, AuthRequest } from "../middleware/auth";

const router = express.Router();

// GET /api/profile - Fetch the bio profile settings for the authenticated user
router.get("/api/profile", authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user?.id;
    let profile = await Profile.findOne({ owner: userId });
    
    if (!profile) {
      profile = new Profile({
        name: req.user?.username || "LinkFlow Kullanıcısı",
        bio: "Kaydettiğim harika bağlantılar ve koleksiyonlar.",
        avatarUrl: "",
        theme: "purple-dark",
        owner: userId,
      });
      await profile.save();
    }
    
    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: "Profil bilgileri yüklenemedi" });
  }
});

// POST /api/profile - Create or update bio profile settings for the authenticated user
router.post("/api/profile", authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user?.id;
    const { name, bio, avatarUrl, theme } = req.body;
    
    const profile = await Profile.findOneAndUpdate(
      { owner: userId },
      { name, bio, avatarUrl, theme, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    
    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: "Profil güncellenemedi" });
  }
});

// GET /bio/:username - Server-Side Rendered (SSR) public bio page for a specific user
router.get("/bio/:username", async (req: express.Request, res: Response): Promise<any> => {
  try {
    const username = String(req.params.username).trim().toLowerCase();

    // 1. Find User
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="tr">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Kullanıcı Bulunamadı - LinkFlow</title>
          <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;700&display=swap" rel="stylesheet">
          <style>
            body { font-family: 'Outfit', sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #1a1a2e; color: #fff; text-align: center; }
            .card { background: rgba(255,255,255,0.05); padding: 40px; border-radius: 24px; border: 1px solid rgba(255,255,255,0.1); max-width: 400px; }
            h1 { color: #ff5e62; font-size: 28px; margin-bottom: 12px; }
            p { font-size: 16px; opacity: 0.8; margin-bottom: 24px; }
            .btn { background: #6200ee; color: #fff; padding: 12px 24px; border-radius: 12px; text-decoration: none; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Kullanıcı Bulunamadı</h1>
            <p>Aradığınız "${escapeHtml(username)}" adlı kullanıcı LinkFlow sisteminde kayıtlı değil.</p>
            <a href="https://github.com/miracerdin1/mobile" class="btn">LinkFlow'u Keşfet</a>
          </div>
        </body>
        </html>
      `);
    }

    // 2. Fetch Profile Settings
    let profile = await Profile.findOne({ owner: user._id });
    if (!profile) {
      profile = new Profile({
        name: user.username,
        bio: "Kaydettiğim harika bağlantılar ve koleksiyonlar.",
        avatarUrl: "",
        theme: "purple-dark",
      });
    }

    // 3. Fetch Public Folders belonging to this user
    const publicFolders = await Folder.find({ owner: user._id, isPublic: true }).sort({ name: 1 });
    const publicFolderIds = publicFolders.map((f) => f._id);

    // 4. Fetch Public Links (either explicitly marked public, or inside public folders owned by this user)
    const publicLinks = await Link.find({
      owner: user._id,
      $or: [
        { isPublic: true },
        { folderId: { $in: publicFolderIds } }
      ]
    }).sort({ createdAt: -1 });

    // 5. Group links by Folder
    const groupedLinks: { [key: string]: any[] } = {};
    const uncategorizedLinks: any[] = [];

    publicLinks.forEach((link) => {
      if (link.folderId) {
        const folderIdStr = link.folderId.toString();
        if (groupedLinks[folderIdStr]) {
          groupedLinks[folderIdStr].push(link);
        } else {
          groupedLinks[folderIdStr] = [link];
        }
      } else {
        uncategorizedLinks.push(link);
      }
    });

    // 6. Select Theme styles
    let themeStyles = "";
    let backgroundGradient = "";

    switch (profile.theme) {
      case "sunset":
        backgroundGradient = "linear-gradient(135deg, #ff5e62 0%, #ff9966 100%)";
        themeStyles = `
          body { color: #2d1303; }
          .profile-container { background: rgba(255, 255, 255, 0.25); border: 1px solid rgba(255, 255, 255, 0.4); }
          .link-card { background: rgba(255, 255, 255, 0.85); color: #2d1303; border: 1px solid rgba(255, 255, 255, 0.5); }
          .link-card:hover { transform: translateY(-3px); box-shadow: 0 10px 20px rgba(255, 94, 98, 0.2); }
          .folder-header { color: #fff; background: rgba(255, 94, 98, 0.85); }
        `;
        break;
      case "nordic-light":
        backgroundGradient = "linear-gradient(135deg, #eef2f3 0%, #8e9eab 100%)";
        themeStyles = `
          body { color: #2c3e50; }
          .profile-container { background: rgba(255, 255, 255, 0.6); border: 1px solid rgba(255, 255, 255, 0.8); }
          .link-card { background: #ffffff; color: #2c3e50; border: 1px solid #e0e0e0; }
          .link-card:hover { transform: translateY(-3px); box-shadow: 0 10px 20px rgba(0, 0, 0, 0.05); }
          .folder-header { color: #2c3e50; background: #ffffff; border: 1px solid #e0e0e0; }
        `;
        break;
      case "glassmorphic":
        backgroundGradient = "radial-gradient(circle at 50% 50%, #1a1a2e 0%, #0f0c1b 100%)";
        themeStyles = `
          body { color: #ffffff; }
          .profile-container { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); backdrop-filter: blur(20px); }
          .link-card { background: rgba(255, 255, 255, 0.05); color: #ffffff; border: 1px solid rgba(255, 255, 255, 0.08); backdrop-filter: blur(10px); }
          .link-card:hover { transform: translateY(-3px); background: rgba(255, 255, 255, 0.1); border-color: rgba(255, 255, 255, 0.2); box-shadow: 0 10px 25px rgba(255, 255, 255, 0.05); }
          .folder-header { color: #ffffff; background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.15); }
        `;
        break;
      case "purple-dark":
      default:
        backgroundGradient = "linear-gradient(135deg, #1f1c2c 0%, #928dab 100%)";
        themeStyles = `
          body { color: #ffffff; }
          .profile-container { background: rgba(31, 28, 44, 0.4); border: 1px solid rgba(255, 255, 255, 0.1); backdrop-filter: blur(15px); }
          .link-card { background: rgba(255, 255, 255, 0.1); color: #ffffff; border: 1px solid rgba(255, 255, 255, 0.15); }
          .link-card:hover { transform: translateY(-3px); background: rgba(255, 255, 255, 0.15); border-color: rgba(255, 255, 255, 0.3); box-shadow: 0 10px 20px rgba(98, 0, 238, 0.25); }
          .folder-header { color: #ffffff; background: rgba(98, 0, 238, 0.7); }
        `;
        break;
    }

    // Default Avatar SVG if none provided
    const avatarImg = profile.avatarUrl 
      ? `<img src="${escapeHtml(profile.avatarUrl)}" class="profile-avatar" alt="${escapeHtml(profile.name)}">`
      : `<div class="profile-avatar-fallback">${escapeHtml(profile.name.charAt(0).toUpperCase())}</div>`;

    // Render public links HTML
    let linksHtml = "";

    // A. Render links grouped by Folder
    publicFolders.forEach((folder) => {
      const folderLinks = groupedLinks[folder._id.toString()] || [];
      if (folderLinks.length > 0) {
        linksHtml += `
          <div class="folder-section">
            <div class="folder-header" style="border-left: 5px solid ${escapeHtml(folder.color || '#6200ee')}">
              <span>${escapeHtml(folder.name)}</span>
            </div>
            <div class="links-grid">
        `;

        folderLinks.forEach((link) => {
          linksHtml += `
            <a href="${escapeHtml(link.url)}" target="_blank" class="link-card">
              ${link.imageUrl ? `<img src="${escapeHtml(link.imageUrl)}" class="link-image" alt="${escapeHtml(link.title || '')}">` : ""}
              <div class="link-info">
                <div class="link-title">${escapeHtml(link.title || link.url)}</div>
                ${link.description ? `<div class="link-desc">${escapeHtml(link.description)}</div>` : ""}
                <span class="link-domain">${escapeHtml(link.siteName || new URL(link.url).hostname)}</span>
              </div>
            </a>
          `;
        });

        linksHtml += `
            </div>
          </div>
        `;
      }
    });

    // B. Render Uncategorized Public Links
    if (uncategorizedLinks.length > 0) {
      linksHtml += `
        <div class="folder-section">
          <div class="folder-header" style="border-left: 5px solid #666">
            <span>Genel Bağlantılar</span>
          </div>
          <div class="links-grid">
      `;

      uncategorizedLinks.forEach((link) => {
        linksHtml += `
          <a href="${escapeHtml(link.url)}" target="_blank" class="link-card">
            ${link.imageUrl ? `<img src="${escapeHtml(link.imageUrl)}" class="link-image" alt="${escapeHtml(link.title || '')}">` : ""}
            <div class="link-info">
              <div class="link-title">${escapeHtml(link.title || link.url)}</div>
              ${link.description ? `<div class="link-desc">${escapeHtml(link.description)}</div>` : ""}
              <span class="link-domain">${escapeHtml(link.siteName || new URL(link.url).hostname)}</span>
            </div>
          </a>
        `;
      });

      linksHtml += `
          </div>
        </div>
      `;
    }

    if (linksHtml === "") {
      linksHtml = `
        <div class="empty-state">
          <p>Henüz herkese açık bağlantı eklenmemiş.</p>
        </div>
      `;
    }

    // Compose HTML template
    const html = `
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(profile.name)} (@${escapeHtml(user.username)}) - Bio LinkFlow</title>
  <meta name="description" content="${escapeHtml(profile.bio)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', sans-serif;
      min-height: 100vh;
      background: ${backgroundGradient};
      background-attachment: fixed;
      display: flex;
      justify-content: center;
      padding: 40px 20px;
      line-height: 1.5;
    }
    
    .profile-container {
      width: 100%;
      max-width: 680px;
      border-radius: 24px;
      padding: 32px 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
    }
    
    /* Header Section */
    .profile-header {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      margin-bottom: 32px;
      width: 100%;
    }
    .profile-avatar {
      width: 96px;
      height: 96px;
      border-radius: 50%;
      object-fit: cover;
      border: 3px solid rgba(255, 255, 255, 0.8);
      box-shadow: 0 10px 20px rgba(0, 0, 0, 0.1);
      margin-bottom: 16px;
    }
    .profile-avatar-fallback {
      width: 96px;
      height: 96px;
      border-radius: 50%;
      background: linear-gradient(135deg, #6200ee 0%, #e91e63 100%);
      color: white;
      font-size: 36px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 3px solid rgba(255, 255, 255, 0.8);
      box-shadow: 0 10px 20px rgba(0, 0, 0, 0.1);
      margin-bottom: 16px;
    }
    .profile-name {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.5px;
      margin-bottom: 6px;
    }
    .profile-username {
      font-size: 13px;
      font-weight: bold;
      opacity: 0.7;
      margin-top: -4px;
      margin-bottom: 8px;
      letter-spacing: 0.5px;
      background: rgba(255,255,255,0.1);
      padding: 2px 10px;
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .profile-bio {
      font-size: 15px;
      opacity: 0.85;
      font-weight: 400;
      max-width: 480px;
    }
    
    /* Content Layout */
    .folder-section {
      width: 100%;
      margin-bottom: 28px;
    }
    .folder-header {
      font-size: 16px;
      font-weight: 800;
      padding: 8px 16px;
      border-radius: 12px;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .links-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .link-card {
      display: flex;
      text-decoration: none;
      border-radius: 16px;
      overflow: hidden;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      cursor: pointer;
    }
    .link-image {
      width: 80px;
      height: 80px;
      object-fit: cover;
      background-color: rgba(255,255,255,0.1);
      border-right: 1px solid rgba(0, 0, 0, 0.05);
    }
    .link-info {
      flex: 1;
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-width: 0;
    }
    .link-title {
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .link-desc {
      font-size: 12px;
      opacity: 0.75;
      margin-bottom: 4px;
      display: -webkit-box;
      -webkit-line-clamp: 1;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .link-domain {
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      opacity: 0.5;
      letter-spacing: 0.5px;
    }
    
    .empty-state {
      padding: 40px;
      text-align: center;
      opacity: 0.7;
    }
    
    /* Footer */
    .profile-footer {
      margin-top: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0.6;
      font-size: 11px;
      letter-spacing: 0.5px;
      transition: opacity 0.2s;
    }
    .profile-footer:hover {
      opacity: 0.9;
    }
    .profile-footer a {
      color: inherit;
      text-decoration: none;
      font-weight: 800;
      margin-left: 4px;
    }
    
    /* Custom Theme injected */
    ${themeStyles}
  </style>
</head>
<body>
  <div class="profile-container">
    <div class="profile-header">
      ${avatarImg}
      <h1 class="profile-name">${escapeHtml(profile.name)}</h1>
      <div class="profile-username">@${escapeHtml(user.username)}</div>
      <p class="profile-bio">${escapeHtml(profile.bio)}</p>
    </div>
    
    ${linksHtml}
    
    <div class="profile-footer">
      <span>Powered by</span>
      <a href="https://github.com/miracerdin1/mobile" target="_blank">📄 LinkFlow</a>
    </div>
  </div>
</body>
</html>
    `;

    res.send(html);
  } catch (error) {
    console.error("Bio page render error:", error);
    res.status(500).send("Bio sayfası yüklenirken bir hata oluştu.");
  }
});

// GET /bio - Redirect legacy route to a friendly welcome / placeholder
router.get("/bio", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="tr">
    <head>
      <meta charset="UTF-8">
      <title>LinkFlow Bio</title>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;700&display=swap" rel="stylesheet">
      <style>
        body { font-family: 'Outfit', sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #1a1a2e; color: #fff; text-align: center; }
        .card { background: rgba(255,255,255,0.05); padding: 40px; border-radius: 24px; border: 1px solid rgba(255,255,255,0.1); max-width: 400px; }
        h1 { color: #6200ee; font-size: 28px; margin-bottom: 12px; }
        p { font-size: 16px; opacity: 0.8; margin-bottom: 24px; }
        .btn { background: #03dac6; color: #000; padding: 12px 24px; border-radius: 12px; text-decoration: none; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>LinkFlow Bio Alanı</h1>
        <p>Lütfen kendi kullanıcı adınız ile bio sayfanızı açın. Örn: /bio/kullanici_adiniz</p>
      </div>
    </body>
    </html>
  `);
});

export default router;
