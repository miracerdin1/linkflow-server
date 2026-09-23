import escapeHtml from "escape-html";
import express, { Response } from "express";
import User from "../models/User";
import Folder from "../models/Folder";
import Link from "../models/Link";
import Profile from "../models/Profile";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import { isSafeExternalUrl } from "../utils/url";
import { renderBioPage } from "../views/bioPage";

const router = express.Router();
const ALLOWED_PROFILE_THEMES = new Set(["purple-dark", "sunset", "nordic-light", "glassmorphic"]);

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

    if (avatarUrl && !isSafeExternalUrl(avatarUrl)) {
      return res.status(400).json({ error: "Avatar URL gecerli bir HTTP veya HTTPS adresi olmalidir" });
    }

    if (theme && !ALLOWED_PROFILE_THEMES.has(theme)) {
      return res.status(400).json({ error: "Gecersiz profil temasi" });
    }
    
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
            body { font-family: 'Outfit', sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f7fb; color: #162033; text-align: center; }
            .card { background: #ffffff; padding: 40px; border-radius: 24px; border: 1px solid #dce2ec; max-width: 400px; box-shadow: 0 12px 32px rgba(28,52,127,0.08); }
            h1 { color: #3157d5; font-size: 28px; margin-bottom: 12px; }
            p { font-size: 16px; opacity: 0.8; margin-bottom: 24px; }
            .btn { background: #3157d5; color: #fff; padding: 12px 24px; border-radius: 12px; text-decoration: none; font-weight: bold; }
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

    // 5. Group links by folder and render
    const toBioLink = (link: any) => ({
      url: link.url,
      title: link.title,
      description: link.description,
      imageUrl: link.imageUrl,
      siteName: link.siteName,
    });
    const byFolder = new Map<string, any[]>();
    const looseLinks: any[] = [];
    publicLinks.forEach((link) => {
      if (!link.folderId) return looseLinks.push(link);
      const key = link.folderId.toString();
      byFolder.set(key, [...(byFolder.get(key) ?? []), link]);
    });

    res.send(
      renderBioPage({
        name: profile.name,
        username: user.username,
        bio: profile.bio,
        avatarUrl: profile.avatarUrl,
        theme: profile.theme,
        folders: publicFolders.map((folder) => ({
          name: folder.name,
          color: folder.color,
          links: (byFolder.get(folder._id.toString()) ?? []).map(toBioLink),
        })),
        looseLinks: looseLinks.map(toBioLink),
        recent: publicLinks.map(toBioLink),
      }),
    );
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
        body { font-family: 'Outfit', sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f7fb; color: #162033; text-align: center; }
        .card { background: #ffffff; padding: 40px; border-radius: 24px; border: 1px solid #dce2ec; max-width: 400px; box-shadow: 0 12px 32px rgba(28,52,127,0.08); }
        h1 { color: #3157d5; font-size: 28px; margin-bottom: 12px; }
        p { font-size: 16px; opacity: 0.8; margin-bottom: 24px; }
        .btn { background: #3157d5; color: #ffffff; padding: 12px 24px; border-radius: 12px; text-decoration: none; font-weight: bold; }
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

// GET /privacy - SSR beautiful privacy policy page
router.get("/privacy", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="tr">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Gizlilik Politikası - LinkFlow</title>
      <meta name="description" content="LinkFlow Gizlilik Politikası ve Veri Güvenliği Beyanı.">
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;800&display=swap" rel="stylesheet">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: 'Outfit', sans-serif;
          min-height: 100vh;
          background: radial-gradient(circle at 50% 50%, #1a1a2e 0%, #0f0c1b 100%);
          background-attachment: fixed;
          display: flex;
          flex-direction: column;
          align-items: center;
          color: #ffffff;
          padding: 40px 20px;
          line-height: 1.6;
        }
        
        .header {
          width: 100%;
          max-width: 800px;
          margin-bottom: 24px;
          text-align: center;
          animation: fadeIn 0.8s ease-out;
        }
        
        .logo {
          font-size: 32px;
          font-weight: 800;
          letter-spacing: -1px;
          background: linear-gradient(135deg, #a78bfa 0%, #6366f1 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin-bottom: 8px;
          display: inline-block;
        }

        .container {
          width: 100%;
          max-width: 800px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-radius: 24px;
          padding: 40px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
          animation: slideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1);
        }

        h1 {
          font-size: 28px;
          font-weight: 800;
          letter-spacing: -0.5px;
          margin-bottom: 12px;
          color: #ffffff;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          padding-bottom: 16px;
        }

        .update-date {
          font-size: 13px;
          opacity: 0.6;
          font-weight: 600;
          margin-bottom: 32px;
          display: block;
        }

        h2 {
          font-size: 20px;
          font-weight: 700;
          color: #a78bfa;
          margin-top: 32px;
          margin-bottom: 12px;
          display: flex;
          align-items: center;
        }

        p {
          font-size: 15px;
          opacity: 0.85;
          margin-bottom: 16px;
          font-weight: 400;
        }

        .callout {
          background: rgba(99, 102, 241, 0.1);
          border-left: 4px solid #6366f1;
          border-radius: 12px;
          padding: 20px;
          margin: 24px 0;
        }

        .callout-title {
          font-weight: 700;
          color: #ffffff;
          margin-bottom: 8px;
          font-size: 15px;
        }

        ul {
          margin-left: 20px;
          margin-bottom: 20px;
        }

        li {
          font-size: 15px;
          opacity: 0.85;
          margin-bottom: 8px;
        }

        li strong {
          color: #e0d7ff;
        }

        .footer {
          margin-top: 40px;
          text-align: center;
          opacity: 0.6;
          font-size: 12px;
          animation: fadeIn 1s ease-out;
        }

        .footer a {
          color: #a78bfa;
          text-decoration: none;
          font-weight: 700;
        }

        .footer a:hover {
          text-decoration: underline;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @media (max-width: 600px) {
          .container {
            padding: 24px;
          }
          h1 {
            font-size: 24px;
          }
          h2 {
            font-size: 18px;
          }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="logo">LinkFlow</div>
      </div>
      <div class="container">
        <h1>Gizlilik Politikası</h1>
        <span class="update-date">Son Güncelleme: 26 Mayıs 2026</span>
        
        <p>LinkFlow olarak gizliliğinize ve veri güvenliğinize en üst düzeyde önem veriyoruz. Bu Gizlilik Politikası, mobil uygulamamızı ve web servislerimizi kullandığınızda toplanan verilerin türlerini, bunların nasıl kullanıldığını ve verilerinizi korumak için aldığımız güvenlik önlemlerini açıklamaktadır.</p>

        <h2>1. Toplanan Veriler ve Kullanım Amaçları</h2>
        <p>Uygulamamızı güvenli, hızlı ve işlevsel bir şekilde sunabilmek amacıyla yalnızca aşağıdaki verileri topluyoruz:</p>
        <ul>
          <li><strong>E-posta Adresi:</strong> Kullanıcı kaydı oluşturmak, hesabınıza güvenli giriş yapmanızı sağlamak, şifre sıfırlama işlemlerini gerçekleştirmek ve Premium aboneliklerinizi yönetmek amacıyla toplanır.</li>
          <li><strong>IP Adresi:</strong> Sunucu güvenliğinin sağlanması, yetkisiz veya kötü niyetli erişimlerin (spam, bot saldırıları vb.) engellenmesi, rate-limiting (hız sınırlandırması) kontrolü ve temel analitik amaçlar doğrultusunda geçici olarak toplanır.</li>
          <li><strong>Profil Bilgileri:</strong> Kullanıcının isteğe bağlı olarak belirlediği İsim, Biyografi, Avatar Görseli ve Tema bilgileri, kişiselleştirilmiş "Bio" sayfasının sunulması amacıyla saklanır.</li>
          <li><strong>Klasör ve Bağlantı (Link) Verileri:</strong> Uygulama içerisine kaydettiğiniz bağlantılar (URL'ler), bu bağlantılara ait sistem tarafından otomatik çekilen başlık, açıklama ve görsel bilgileri ile düzenlediğiniz klasör yapıları saklanır. Bu veriler, aksi sizin tarafınızdan belirtilmedikçe (Klasörü veya Linki "Herkese Açık/Public" olarak işaretlemediğiniz sürece) tamamen gizlidir ve sadece sizin erişiminize sunulur.</li>
        </ul>

        <div class="callout">
          <div class="callout-title">🔒 Pano (Clipboard) Verilerinin İşlenmesi Hakkında Önemli Bilgilendirme</div>
          <p>LinkFlow, cihazınızın panosunu (clipboard) <strong>asla arka planda veya gizlice otomatik olarak okumaz</strong>. Panonuzdaki veriler yalnızca siz uygulamada yer alan <strong>"Panodan Hızlı Ekle" (Home ekranında)</strong> veya <strong>"Panodan Yapıştır" (Link Ekleme ekranında)</strong> butonlarına <strong>aktif olarak dokunduğunuzda</strong> taranır. Bu işlem tamamen cihazınız üzerinde gerçekleşir. Panonuzda bir internet adresi (URL) bulunursa tespit edilir ve size gösterilir. Kaydetmeyi onaylamadığınız sürece hiçbir pano verisi sunucularımıza gönderilmez veya kaydedilmez.</p>
        </div>

        <h2>2. Veri Güvenliği ve Saklanması</h2>
        <p>Toplanan tüm veriler, endüstri standardı güvenlik protokolleri (SSL/TLS şifreleme) kullanılarak sunucularımıza iletilir ve güvenli, şifrelenmiş veritabanlarımızda saklanır. Yetkisiz erişimleri engellemek için sunucu altyapımız sürekli olarak güncellenmekte ve denetlenmektedir.</p>

        <h2>3. Hesap ve Verilerin Silinmesi</h2>
        <p>Kullanıcılarımızın kendi verileri üzerinde tam kontrol hakkı vardır. İstediğiniz zaman uygulama içi Ayarlar menüsünden <strong>"Hesabı Kalıcı Olarak Sil"</strong> seçeneğini kullanarak hesabınızı silebilirsiniz. Bu işlem gerçekleştirildiğinde, hesabınızla ilişkili tüm e-posta, şifre, profil bilgileri, kaydettiğiniz tüm klasörler ve bağlantılar sunucularımızdan <strong>geri döndürülemez şekilde kalıcı olarak silinir</strong>.</p>

        <h2>4. İletişim</h2>
        <p>Gizlilik politikamız veya veri uygulamalarımız hakkında herhangi bir sorunuz olması durumunda bizimle <a href="mailto:support@linkflow.com">support@linkflow.com</a> adresi üzerinden iletişime geçebilirsiniz.</p>
      </div>
      <div class="footer">
        <span>&copy; 2026 LinkFlow. Tüm Hakları Saklıdır.</span>
        <br>
        <a href="/terms">Kullanım Koşulları</a>
      </div>
    </body>
    </html>
  `);
});

// GET /terms - SSR beautiful terms and conditions page
router.get("/terms", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="tr">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Kullanım Koşulları - LinkFlow</title>
      <meta name="description" content="LinkFlow Kullanım Koşulları ve Üyelik Sözleşmesi.">
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;800&display=swap" rel="stylesheet">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: 'Outfit', sans-serif;
          min-height: 100vh;
          background: radial-gradient(circle at 50% 50%, #1a1a2e 0%, #0f0c1b 100%);
          background-attachment: fixed;
          display: flex;
          flex-direction: column;
          align-items: center;
          color: #ffffff;
          padding: 40px 20px;
          line-height: 1.6;
        }
        
        .header {
          width: 100%;
          max-width: 800px;
          margin-bottom: 24px;
          text-align: center;
          animation: fadeIn 0.8s ease-out;
        }
        
        .logo {
          font-size: 32px;
          font-weight: 800;
          letter-spacing: -1px;
          background: linear-gradient(135deg, #a78bfa 0%, #6366f1 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin-bottom: 8px;
          display: inline-block;
        }

        .container {
          width: 100%;
          max-width: 800px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-radius: 24px;
          padding: 40px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
          animation: slideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1);
        }

        h1 {
          font-size: 28px;
          font-weight: 800;
          letter-spacing: -0.5px;
          margin-bottom: 12px;
          color: #ffffff;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          padding-bottom: 16px;
        }

        .update-date {
          font-size: 13px;
          opacity: 0.6;
          font-weight: 600;
          margin-bottom: 32px;
          display: block;
        }

        h2 {
          font-size: 20px;
          font-weight: 700;
          color: #a78bfa;
          margin-top: 32px;
          margin-bottom: 12px;
          display: flex;
          align-items: center;
        }

        p {
          font-size: 15px;
          opacity: 0.85;
          margin-bottom: 16px;
          font-weight: 400;
        }

        ul {
          margin-left: 20px;
          margin-bottom: 20px;
        }

        li {
          font-size: 15px;
          opacity: 0.85;
          margin-bottom: 8px;
        }

        li strong {
          color: #e0d7ff;
        }

        .footer {
          margin-top: 40px;
          text-align: center;
          opacity: 0.6;
          font-size: 12px;
          animation: fadeIn 1s ease-out;
        }

        .footer a {
          color: #a78bfa;
          text-decoration: none;
          font-weight: 700;
        }

        .footer a:hover {
          text-decoration: underline;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @media (max-width: 600px) {
          .container {
            padding: 24px;
          }
          h1 {
            font-size: 24px;
          }
          h2 {
            font-size: 18px;
          }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="logo">LinkFlow</div>
      </div>
      <div class="container">
        <h1>Kullanım Koşulları</h1>
        <span class="update-date">Son Güncelleme: 26 Mayıs 2026</span>
        
        <p>LinkFlow mobil uygulamasını veya web servislerini kullanarak aşağıdaki Kullanım Koşullarını kabul etmiş olursunuz. Lütfen hizmetlerimizi kullanmaya başlamadan önce bu koşulları dikkatlice okuyunuz.</p>

        <h2>1. Kabul Edilen Şartlar</h2>
        <p>LinkFlow platformuna üye olarak veya platformu ziyaret ederek, bu sözleşmede yer alan tüm şartları ve bu şartlarla ilişkili Gizlilik Politikamızı tamamen kabul etmiş sayılırsınız. Şartları kabul etmiyorsanız platformu kullanmamalısınız.</p>

        <h2>2. Hesap Sorumluluğu</h2>
        <ul>
          <li>Platformu kullanabilmek için geçerli bir e-posta adresiyle hesap oluşturmanız gerekmektedir.</li>
          <li>Hesabınızın güvenliğini ve şifrenizin gizliliğini korumak tamamen sizin sorumluluğunuzdadır.</li>
          <li>Hesabınız aracılığıyla gerçekleştirilen tüm işlemlerden doğrudan siz sorumlu tutulursunuz.</li>
        </ul>

        <h2>3. Kullanım Kuralları ve Yasaklar</h2>
        <p>Hizmetimizi kullanırken aşağıdaki kurallara uymayı taahhüt edersiniz:</p>
        <ul>
          <li><strong>Yasalara Uygunluk:</strong> LinkFlow'u hiçbir yasa dışı, telif hakkı ihlali barındıran veya hukuka aykırı amaç için kullanamazsınız.</li>
          <li><strong>Kötüye Kullanım:</strong> Sunucu güvenliğimizi tehdit edecek, platformun çalışmasını engelleyecek veya diğer kullanıcıların deneyimini bozacak hiçbir teknik müdahalede (DDoS, tersine mühendislik, kod enjeksiyonu vb.) bulunamazsınız.</li>
          <li><strong>Zararlı İçerik:</strong> Spam, virüs, malware içeren veya zararlı sitelere yönlendiren bağlantıları sisteme kaydedemez ve Bio sayfanız üzerinden paylaşamazsınız.</li>
        </ul>

        <h2>4. Ücretlendirme ve Abonelikler</h2>
        <p>LinkFlow, temel özellikleri ücretsiz (Free Plan) olarak sunar. Daha fazla özellik, sınırsız bağlantı kaydetme ve ekstra klasör limitleri için Pro Plan aboneliği sunulmaktadır.</p>
        <ul>
          <li>Premium abonelikler App Store ve Google Play faturalandırma altyapıları üzerinden yürütülür.</li>
          <li>Abonelik yenilenmeleri, ödemeler, iadeler ve iptal işlemleri tamamen ilgili mağazanın (Apple / Google) abonelik politikalarına ve ayarlarına tabidir.</li>
        </ul>

        <h2>5. Sorumluluk Sınırlandırması</h2>
        <p>LinkFlow, hizmetin kesintisiz, hatasız veya %100 kullanılabilir olacağını garanti etmez. Platformda saklanan verilerin yedeklenmesi kullanıcının sorumluluğundadır. Teknik arızalardan, veri kayıplarından veya hizmet kesintilerinden doğabilecek doğrudan ya da dolaylı zararlardan LinkFlow hiçbir şekilde sorumlu tutulamaz.</p>

        <h2>6. Değişiklikler</h2>
        <p>LinkFlow, bu Kullanım Koşullarını dilediği zaman güncelleme hakkını saklı tutar. Değişiklikler yapıldığında güncel şartlar bu sayfa üzerinden yayınlanacaktır.</p>
      </div>
      <div class="footer">
        <span>&copy; 2026 LinkFlow. Tüm Hakları Saklıdır.</span>
        <br>
        <a href="/privacy">Gizlilik Politikası</a>
      </div>
    </body>
    </html>
  `);
});

export default router;
