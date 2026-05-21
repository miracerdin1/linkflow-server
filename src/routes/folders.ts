import express from "express";
import Folder from "../models/Folder";
import Link from "../models/Link";

const router = express.Router();

// GET /api/folders - Get all folders
router.get("/", async (req, res) => {
  try {
    const folders = await Folder.find().sort({ name: 1 });
    res.json(folders);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch folders" });
  }
});

// POST /api/folders - Create a new folder
router.post("/", async (req, res) => {
  try {
    const { name, icon, color } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Folder name is required" });
    }

    const newFolder = new Folder({
      name,
      icon,
      color,
    });

    await newFolder.save();
    res.status(201).json(newFolder);
  } catch (error) {
    res.status(500).json({ error: "Failed to create folder" });
  }
});

// PUT /api/folders/:id - Update a folder
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, icon, color } = req.body;

    const updatedFolder = await Folder.findByIdAndUpdate(
      id,
      { name, icon, color },
      { new: true }
    );

    if (!updatedFolder) {
      return res.status(404).json({ error: "Folder not found" });
    }

    res.json(updatedFolder);
  } catch (error) {
    res.status(500).json({ error: "Failed to update folder" });
  }
});

// DELETE /api/folders/:id - Delete a folder
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const deletedFolder = await Folder.findByIdAndDelete(id);

    if (!deletedFolder) {
      return res.status(404).json({ error: "Folder not found" });
    }

    // Unassign links that were in this folder
    await Link.updateMany({ folderId: id }, { folderId: null });

    res.json({ message: "Folder deleted successfully, and its links were unassigned." });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete folder" });
  }
});

export default router;
