import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { createServer } from "http";
import mongoose from "mongoose";
import { Server } from "socket.io";
import linkRoutes from "./routes/links";
import folderRoutes from "./routes/folders";
import publicRoutes from "./routes/public";
import authRoutes from "./routes/auth";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Setup HTTP Server & Socket.io
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
});

// Attach io instance to express app so routes can access it
app.set("io", io);

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
app.use("/api/auth", authRoutes);
app.use("/api/links", linkRoutes);
app.use("/api/folders", folderRoutes);
app.use("/", publicRoutes);

// Socket.io connection logic
io.on("connection", (socket) => {
  console.log(`[Socket Connected] Client ID: ${socket.id}`);

  // Client joins a folder room to listen to real-time updates inside it
  socket.on("join_folder", (folderId) => {
    if (folderId) {
      socket.join(`folder_${folderId}`);
      console.log(`[Socket Room] Client ${socket.id} joined room folder_${folderId}`);
    }
  });

  // Client leaves a folder room
  socket.on("leave_folder", (folderId) => {
    if (folderId) {
      socket.leave(`folder_${folderId}`);
      console.log(`[Socket Room] Client ${socket.id} left room folder_${folderId}`);
    }
  });

  socket.on("disconnect", () => {
    console.log(`[Socket Disconnected] Client ID: ${socket.id}`);
  });
});

// MongoDB Connection
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

// Use httpServer to listen so WebSockets work
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  connectDB();
});
