import "dotenv/config";
import cors from "cors";
import express from "express";
import { createServer } from "http";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { Server } from "socket.io";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import linkRoutes from "./routes/links";
import folderRoutes from "./routes/folders";
import publicRoutes from "./routes/public";
import authRoutes from "./routes/auth";
import paymentsRoutes from "./routes/payments";
import Folder from "./models/Folder";
import { getJwtSecret } from "./config/auth";
import { AuthTokenPayload } from "./types/auth";

const app = express();
const PORT = process.env.PORT || 3000;
const corsOrigins = process.env.CORS_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const isCorsOriginAllowed = (origin?: string) => {
  if (!origin) return true;
  if (!corsOrigins?.length) return process.env.NODE_ENV !== "production";

  return corsOrigins.includes(origin);
};

getJwtSecret();

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (isCorsOriginAllowed(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Socket origin is not allowed."));
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
});

app.set("io", io);
app.set("trust proxy", 1);

app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    if (isCorsOriginAllowed(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("Origin is not allowed."));
  },
}));
app.use((req, res, next) => {
  if (req.originalUrl === '/api/payments/webhook') {
    next();
  } else {
    express.json({ limit: "100kb" })(req, res, next);
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many login attempts. Please try again later." },
});

app.use((req, res, next) => {
  console.log(`[Incoming Request] ${req.method} ${req.url}`);
  next();
});

app.get("/", (req, res) => {
  res.send("LinkFlow API is Running");
});

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/links", linkRoutes);
app.use("/api/folders", folderRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/", publicRoutes);

io.use((socket, next) => {
  const authToken = socket.handshake.auth?.token;
  const authHeader = socket.handshake.headers.authorization;
  const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  const token = typeof authToken === "string" ? authToken : headerToken;

  if (!token) {
    next(new Error("Authentication required."));
    return;
  }

  try {
    socket.data.user = jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"] }) as AuthTokenPayload;
    next();
  } catch (error) {
    next(new Error("Invalid authentication token."));
  }
});

io.on("connection", (socket) => {
  console.log(`[Socket Connected] Client ID: ${socket.id}`);

  socket.on("join_folder", async (folderId) => {
    if (typeof folderId !== "string" || !folderId) return;

    try {
      const folder = await Folder.findById(folderId);
      const userId = socket.data.user?.id;
      const hasAccess =
        !!folder &&
        ((folder.owner && folder.owner.toString() === userId) ||
          folder.collaborators.some((cId) => cId.toString() === userId));

      if (!hasAccess) {
        socket.emit("folder_join_denied", { folderId });
        return;
      }

      socket.join(`folder_${folderId}`);
      console.log(`[Socket Room] Client ${socket.id} joined room folder_${folderId}`);
    } catch (error) {
      socket.emit("folder_join_denied", { folderId });
    }
  });

  socket.on("leave_folder", (folderId) => {
    if (typeof folderId !== "string" || !folderId) return;

    socket.leave(`folder_${folderId}`);
    console.log(`[Socket Room] Client ${socket.id} left room folder_${folderId}`);
  });

  socket.on("disconnect", () => {
    console.log(`[Socket Disconnected] Client ID: ${socket.id}`);
  });
});

const connectDB = async () => {
  try {
    if (process.env.MONGO_URI) {
      await mongoose.connect(process.env.MONGO_URI);
      console.log("MongoDB Connected");
      return;
    }

    console.log("MONGO_URI is not defined. Running without DB connection for now.");
  } catch (err) {
    console.error("Database connection error:", err);
  }
};

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  connectDB();
});
