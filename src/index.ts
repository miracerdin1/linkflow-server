import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import mongoose from "mongoose";
import linkRoutes from "./routes/links";
import folderRoutes from "./routes/folders";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Debug Middleware: Log all requests
app.use((req, res, next) => {
  console.log(`[Incoming Request] ${req.method} ${req.url}`);
  next();
});

// Basic Route for Health Check
app.get("/", (req, res) => {
  res.send("LinkFlow API is Running");
});

// Routes
app.use("/api/links", linkRoutes);
app.use("/api/folders", folderRoutes);

// MongoDB Connection (Placeholder - Will be updated with real connection string)
const connectDB = async () => {
  try {
    if (process.env.MONGO_URI) {
      await mongoose.connect(process.env.MONGO_URI);
      console.log("MongoDB Connected");
    } else {
      console.log(
        "MONGO_URI is not defined. Running without DB connection for now.",
      );
    }
  } catch (err) {
    console.error("Database connection error:", err);
  }
};

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  connectDB();
});
