import express, { Response } from "express";
import Link from "../models/Link";
import Folder from "../models/Folder";
import { scrapeMetadata } from "../services/scraper";
import { authenticateToken, AuthRequest } from "../middleware/auth";

const router = express.Router();

// Helper to get io instance
const getIo = (req: any) => req.app.get("io");

// GET /api/links - Get links based on authorization and optional folderId
router.get("/", authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const { folderId } = req.query;
    const userId = req.user?.id;

    if (folderId) {
      if (folderId === "null" || folderId === "none") {
        // Fetch uncategorized links (only owned by this user)
        const links = await Link.find({ folderId: null, owner: userId })
          .populate("owner", "username email")
          .sort({ createdAt: -1 });
        return res.json(links);
      } else {
        // Fetch links inside a specific folder. First verify folder access.
        const folder = await Folder.findById(folderId);
        if (!folder) {
          return res.status(404).json({ error: "Klasör bulunamadı" });
        }

        const hasAccess =
          (folder.owner && folder.owner.toString() === userId) ||
          folder.collaborators.some((cId) => cId.toString() === userId);

        if (!hasAccess && !folder.isPublic) {
          return res.status(403).json({ error: "Bu klasördeki linkleri görme yetkiniz yok" });
        }

        const links = await Link.find({ folderId })
          .populate("owner", "username email")
          .sort({ createdAt: -1 });
        return res.json(links);
      }
    }

    // No folderId provided: Fetch "Tümü" (All links owned by the user OR inside folders the user has access to)
    const myFolders = await Folder.find({
      $or: [
        { owner: userId },
        { collaborators: userId }
      ]
    });
    const accessibleFolderIds = myFolders.map((f) => f._id);

    const links = await Link.find({
      $or: [
        { owner: userId },
        { folderId: { $in: accessibleFolderIds } }
      ]
    })
    .populate("owner", "username email")
    .sort({ createdAt: -1 });

    res.json(links);
  } catch (error) {
    res.status(500).json({ error: "Linkler yüklenirken bir hata oluştu" });
  }
});

// POST /api/links - Add a new link
router.post("/", authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const { url, folderId, isPublic } = req.body;
    const userId = req.user?.id;

    if (!url) {
      return res.status(400).json({ error: "URL adresi zorunludur" });
    }

    // If folderId is provided, verify folder write access
    if (folderId) {
      const folder = await Folder.findById(folderId);
      if (!folder) {
        return res.status(404).json({ error: "Klasör bulunamadı" });
      }

      const hasWriteAccess =
        (folder.owner && folder.owner.toString() === userId) ||
        folder.collaborators.some((cId) => cId.toString() === userId);

      if (!hasWriteAccess) {
        return res.status(403).json({ error: "Bu klasöre link ekleme yetkiniz yok" });
      }
    }

    // 1. Scrape Metadata
    const metadata = await scrapeMetadata(url);

    // 2. Create Link Record
    const newLink = new Link({
      url,
      ...metadata,
      folderId: folderId || null,
      isPublic: isPublic || false,
      owner: userId,
    });

    await newLink.save();
    
    const populatedLink = await Link.findById(newLink._id).populate("owner", "username email");

    // WebSocket Notify
    if (folderId) {
      const io = getIo(req);
      if (io) {
        io.to(`folder_${folderId}`).emit("link_created", populatedLink);
      }
    }

    res.status(201).json(populatedLink);
  } catch (error) {
    console.error("Error adding link:", error);
    res.status(500).json({ error: "Bağlantı işlenirken bir hata oluştu" });
  }
});

// PUT /api/links/:id - Update a link
router.put("/:id", authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const { title, description, url, folderId, isPublic } = req.body;
    const userId = req.user?.id;

    const link = await Link.findById(id);
    if (!link) {
      return res.status(404).json({ error: "Link bulunamadı" });
    }

    // Check write authorization
    let folderAccess = false; // DEFAULT TO FALSE!
    if (link.folderId) {
      const folder = await Folder.findById(link.folderId);
      if (folder) {
        folderAccess =
          (folder.owner && folder.owner.toString() === userId) ||
          folder.collaborators.some((cId) => cId.toString() === userId);
      }
    }

    const isLinkOwner = link.owner && link.owner.toString() === userId;

    // Fix IDOR: Only link owner or collaborators can edit title/url.
    // If moving folders, only the link owner can do that (checked below).
    if (!link.folderId) {
      if (!isLinkOwner) {
        return res.status(403).json({ error: "Bu bağlantıyı düzenlemek için yetkiniz yok" });
      }
    } else {
      if (!isLinkOwner && !folderAccess) {
        return res.status(403).json({ error: "Bu bağlantıyı düzenlemek için yetkiniz yok" });
      }
    }

    // If changing folder, verify write access to new folder
    const oldFolderId = link.folderId;
    let newFolderId = link.folderId;

    if (folderId !== undefined) {
      newFolderId = (folderId === "null" || folderId === "") ? null : folderId;
      const oldStr = oldFolderId ? oldFolderId.toString() : "";
      const newStr = newFolderId ? newFolderId.toString() : "";
      
      if (newStr !== oldStr) {
        // Only the link owner can change the folder
        if (!isLinkOwner) {
          return res.status(403).json({ error: "Sadece link sahibi linkin klasörünü değiştirebilir" });
        }

        if (newFolderId) {
          const newFolder = await Folder.findById(newFolderId);
          if (!newFolder) {
            return res.status(404).json({ error: "Hedef klasör bulunamadı" });
          }
          const hasNewFolderAccess =
            (newFolder.owner && newFolder.owner.toString() === userId) ||
            newFolder.collaborators.some((cId) => cId.toString() === userId);
          if (!hasNewFolderAccess) {
            return res.status(403).json({ error: "Hedef klasöre taşımak için yetkiniz yok" });
          }
        }
      }
    }

    // Update fields
    link.title = title !== undefined ? title : link.title;
    link.description = description !== undefined ? description : link.description;
    link.url = url !== undefined ? url : link.url;
    link.folderId = newFolderId as any;
    link.isPublic = isPublic !== undefined ? isPublic : link.isPublic;

    await link.save();
    
    const populatedLink = await Link.findById(link._id).populate("owner", "username email");

    // Handle real-time WebSockets
    const io = getIo(req);
    if (io) {
      const oldFolderStr = oldFolderId ? oldFolderId.toString() : "";
      const newFolderStr = newFolderId ? newFolderId.toString() : "";

      if (oldFolderStr !== newFolderStr) {
        // If folder changed, notify old folder of deletion and new folder of creation
        if (oldFolderId) {
          io.to(`folder_${oldFolderId}`).emit("link_deleted", { linkId: id });
        }
        if (newFolderId) {
          io.to(`folder_${newFolderId}`).emit("link_created", populatedLink);
        }
      } else if (newFolderId) {
        // Standard update
        io.to(`folder_${newFolderId}`).emit("link_updated", populatedLink);
      }
    }

    res.json(populatedLink);
  } catch (error) {
    res.status(500).json({ error: "Bağlantı güncellenemedi" });
  }
});

// DELETE /api/links/:id - Delete a link
router.delete("/:id", authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const link = await Link.findById(id);
    if (!link) {
      return res.status(404).json({ error: "Link bulunamadı" });
    }

    // Check write authorization
    let isFolderOwner = false;
    if (link.folderId) {
      const folder = await Folder.findById(link.folderId);
      if (folder) {
        isFolderOwner = !!(folder.owner && folder.owner.toString() === userId);
      }
    }

    const isLinkOwner = !!(link.owner && link.owner.toString() === userId);

    // Fix IDOR: Only the link owner OR the folder owner can delete the link.
    if (!isLinkOwner && !isFolderOwner) {
      return res.status(403).json({ error: "Bu bağlantıyı silmek için yetkiniz yok" });
    }

    await Link.findByIdAndDelete(id);

    // WebSocket Notify
    if (link.folderId) {
      const io = getIo(req);
      if (io) {
        io.to(`folder_${link.folderId}`).emit("link_deleted", { linkId: id });
      }
    }

    res.json({ message: "Bağlantı başarıyla silindi" });
  } catch (error) {
    res.status(500).json({ error: "Bağlantı silinemedi" });
  }
});

export default router;
