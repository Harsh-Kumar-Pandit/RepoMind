import express from "express";
import cors from "cors";
import healthRoutes from "./routes/health.routes.js";
import repositoryRoutes from "./routes/repository.routes.js";
import fileRoutes from "./routes/file.routes.js";

const app = express();

app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:5173",
}));

app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.json({ message: "Welcome to RepoMind API" });
});

app.use("/api/health", healthRoutes);
app.use("/api/repositories", repositoryRoutes);
app.use("/api/files", fileRoutes);

export default app;