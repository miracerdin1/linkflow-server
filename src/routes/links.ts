import express from "express";
import Link from "../models/Link";
import { scrapeMetadata } from "../services/scraper";

const router = express.Router();

// GET /api/links - Get all links
router.get("/", async (req, res) => {
  try {
    const links = await Link.find().sort({ createdAt: -1 });
    res.json(links);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch links" });
  }
});

// POST /api/links - Add a new link
router.post("/", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    // 1. Scrape Metadata
    const metadata = await scrapeMetadata(url);

    // 2. Create Link Record
    const newLink = new Link({
      url,
      ...metadata,
    });

    await newLink.save();

    res.status(201).json(newLink);
  } catch (error) {
    console.error("Error adding link:", error);
    res.status(500).json({ error: "Failed to process link" });
  }
});

// PUT /api/links/:id - Update a link
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, url } = req.body;

    const updatedLink = await Link.findByIdAndUpdate(
      id,
      { title, description, url },
      { new: true }
    );

    if (!updatedLink) {
      return res.status(404).json({ error: "Link not found" });
    }

    res.json(updatedLink);
  } catch (error) {
    res.status(500).json({ error: "Failed to update link" });
  }
});

// DELETE /api/links/:id - Delete a link
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const deletedLink = await Link.findByIdAndDelete(id);

    if (!deletedLink) {
      return res.status(404).json({ error: "Link not found" });
    }

    res.json({ message: "Link deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete link" });
  }
});

export default router;
