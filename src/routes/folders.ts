import express, { Response } from "express";
import Folder from "../models/Folder";
import Link from "../models/Link";
import User from "../models/User";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import { isHexColor } from "../utils/validation";

const router = express.Router();

// Helper to get io instance
const getIo = (req: any) => req.app.get("io");

// GET /api/folders - Get all folders for the authenticated user (owned + collaborated)
router.get("/", authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const folders = await Folder.find({
      $or: [
        { owner: req.user?.id },
        { collaborators: req.user?.id }
      ]
    })
    .populate("owner", "username email")
    .populate("collaborators", "username email")
    .sort({ name: 1 });

    res.json(folders);
  } catch (error) {
    res.status(500).json({ error: "Klasörler yüklenirken bir hata oluştu" });
  }
});

// POST /api/folders - Create a new folder
router.post("/", authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const { name, icon, color, isPublic } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Klasör adı zorunludur" });
    }

    if (!isHexColor(color)) {
      return res.status(400).json({ error: "Gecersiz klasor rengi" });
    }

    const newFolder = new Folder({
      name,
      icon,
      color,
      isPublic: isPublic || false,
      owner: req.user?.id,
      collaborators: []
    });

    await newFolder.save();
    
    const populatedFolder = await Folder.findById(newFolder._id)
      .populate("owner", "username email")
      .populate("collaborators", "username email");

    res.status(201).json(populatedFolder);
  } catch (error) {
    res.status(500).json({ error: "Klasör oluşturulamadı" });
  }
});

// PUT /api/folders/:id - Update a folder (Only owner can update)
router.put("/:id", authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const { name, icon, color, isPublic } = req.body;

    const folder = await Folder.findById(id);
    if (!folder) {
      return res.status(404).json({ error: "Klasör bulunamadı" });
    }

    if (!isHexColor(color)) {
      return res.status(400).json({ error: "Gecersiz klasor rengi" });
    }

    // Check ownership
    if (folder.owner && folder.owner.toString() !== req.user?.id) {
      return res.status(403).json({ error: "Bu klasörü düzenlemek için yetkiniz yok (Yalnızca sahip düzenleyebilir)" });
    }

    folder.name = name ?? folder.name;
    folder.icon = icon ?? folder.icon;
    folder.color = color ?? folder.color;
    folder.isPublic = isPublic !== undefined ? isPublic : folder.isPublic;

    await folder.save();
    
    const populatedFolder = await Folder.findById(folder._id)
      .populate("owner", "username email")
      .populate("collaborators", "username email");

    // Real-time Update
    const io = getIo(req);
    if (io) {
      io.to(`folder_${id}`).emit("folder_updated", populatedFolder);
    }

    res.json(populatedFolder);
  } catch (error) {
    res.status(500).json({ error: "Klasör güncellenemedi" });
  }
});

// DELETE /api/folders/:id - Delete a folder (Only owner can delete)
router.delete("/:id", authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const { id } = req.params;

    const folder = await Folder.findById(id);
    if (!folder) {
      return res.status(404).json({ error: "Klasör bulunamadı" });
    }

    // Check ownership
    if (folder.owner && folder.owner.toString() !== req.user?.id) {
      return res.status(403).json({ error: "Bu klasörü silmek için yetkiniz yok" });
    }

    await Folder.findByIdAndDelete(id);

    // Unassign links that were in this folder
    await Link.updateMany({ folderId: id }, { folderId: null });

    // Real-time Notify collaborators that folder was deleted
    const io = getIo(req);
    if (io) {
      io.to(`folder_${id}`).emit("folder_deleted", { folderId: id });
    }

    res.json({ message: "Klasör başarıyla silindi ve içindeki linkler klasörsüz olarak güncellendi." });
  } catch (error) {
    res.status(500).json({ error: "Klasör silinemedi" });
  }
});

// POST /api/folders/:id/collaborators - Add a collaborator (Only owner can add)
router.post("/:id/collaborators", authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const { usernameOrEmail } = req.body;

    if (!usernameOrEmail) {
      return res.status(400).json({ error: "Kullanıcı adı veya e-posta adresi belirtilmelidir" });
    }

    const folder = await Folder.findById(id);
    if (!folder) {
      return res.status(404).json({ error: "Klasör bulunamadı" });
    }

    // Check ownership
    if (folder.owner && folder.owner.toString() !== req.user?.id) {
      return res.status(403).json({ error: "Ortak eklemek için klasörün sahibi olmanız gerekir" });
    }

    // Find the invitee user
    const invitee = await User.findOne({
      $or: [
        { username: usernameOrEmail.trim().toLowerCase() },
        { email: usernameOrEmail.trim().toLowerCase() }
      ]
    });

    if (!invitee) {
      return res.status(404).json({ error: "Belirtilen kullanıcı sistemde bulunamadı" });
    }

    // Check if invitee is the owner
    if (folder.owner && folder.owner.toString() === invitee._id.toString()) {
      return res.status(400).json({ error: "Kendinizi ortak olarak ekleyemezsiniz" });
    }

    // Check if already a collaborator
    const isAlreadyCollaborator = folder.collaborators.some(
      (cId) => cId.toString() === invitee._id.toString()
    );

    if (isAlreadyCollaborator) {
      return res.status(400).json({ error: "Bu kullanıcı zaten bu klasörün ortağı" });
    }

    // Add collaborator
    folder.collaborators.push(invitee._id as any);
    await folder.save();

    const populatedFolder = await Folder.findById(folder._id)
      .populate("owner", "username email")
      .populate("collaborators", "username email");

    // Real-time Notify
    const io = getIo(req);
    if (io) {
      io.to(`folder_${id}`).emit("folder_updated", populatedFolder);
      // Trigger update event to the newly added user to refresh their folder list
      io.emit(`user_folder_list_refresh_${invitee._id}`);
    }

    res.json(populatedFolder);
  } catch (error) {
    console.error("Add collaborator error:", error);
    res.status(500).json({ error: "Ortak eklenirken bir hata oluştu" });
  }
});

// DELETE /api/folders/:id/collaborators/:userId - Remove a collaborator (Only owner can remove)
router.delete("/:id/collaborators/:userId", authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const { id, userId } = req.params;

    const folder = await Folder.findById(id);
    if (!folder) {
      return res.status(404).json({ error: "Klasör bulunamadı" });
    }

    // Check ownership
    if (folder.owner && folder.owner.toString() !== req.user?.id) {
      return res.status(403).json({ error: "Ortak çıkarmak için klasörün sahibi olmanız gerekir" });
    }

    // Remove collaborator
    folder.collaborators = folder.collaborators.filter(
      (cId) => cId.toString() !== userId
    );
    await folder.save();

    const populatedFolder = await Folder.findById(folder._id)
      .populate("owner", "username email")
      .populate("collaborators", "username email");

    // Real-time Notify
    const io = getIo(req);
    if (io) {
      io.to(`folder_${id}`).emit("folder_updated", populatedFolder);
      io.to(`folder_${id}`).emit("user_removed", { userId, folderId: id });
      io.emit(`user_folder_list_refresh_${userId}`);
    }

    res.json(populatedFolder);
  } catch (error) {
    res.status(500).json({ error: "Ortak çıkarılamadı" });
  }
});

// POST /api/folders/:id/leave - Leave a shared folder (Collaborators only)
router.post("/:id/leave", authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Yetkisiz işlem" });
    }

    const folder = await Folder.findById(id);
    if (!folder) {
      return res.status(404).json({ error: "Klasör bulunamadı" });
    }

    // Check if user is a collaborator
    const isCollaborator = folder.collaborators.some(
      (cId) => cId.toString() === userId
    );

    if (!isCollaborator) {
      return res.status(400).json({ error: "Zaten bu klasörün ortağı değilsiniz" });
    }

    // Remove from collaborators
    folder.collaborators = folder.collaborators.filter(
      (cId) => cId.toString() !== userId
    );
    await folder.save();

    const populatedFolder = await Folder.findById(folder._id)
      .populate("owner", "username email")
      .populate("collaborators", "username email");

    // Real-time Notify
    const io = getIo(req);
    if (io) {
      io.to(`folder_${id}`).emit("folder_updated", populatedFolder);
      io.to(`folder_${id}`).emit("user_removed", { userId, folderId: id });
      io.emit(`user_folder_list_refresh_${userId}`);
    }

    res.json({ message: "Klasörden başarıyla ayrıldınız." });
  } catch (error) {
    res.status(500).json({ error: "Klasörden ayrılırken bir hata oluştu" });
  }
});

export default router;
