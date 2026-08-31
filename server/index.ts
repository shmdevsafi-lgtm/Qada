import "dotenv/config";
import express from "express";
import cors from "cors";
import { handleDemo } from "./routes/demo";
import authRoutes from "./routes/auth";
import attendanceRoutes from "./routes/attendance";
import membershipRoutes from "./routes/membership";

export function createServer() {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json({ type: () => true }));
  app.use(express.urlencoded({ extended: true }));

  // Example API routes
  app.get("/api/ping", (_req, res) => {
    const ping = process.env.PING_MESSAGE ?? "ping";
    res.json({ message: ping });
  });

  app.get("/api/demo", handleDemo);
  app.use("/api/auth", authRoutes);
  app.use("/api/attendance", attendanceRoutes);
  app.use("/api/membership", membershipRoutes);

  return app;
}
