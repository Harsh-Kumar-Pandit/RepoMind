import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import prisma from "./db/prisma.js";
import authRoutes from "./routes/auth.routes.js";
import cookieParser from "cookie-parser";
import repositoryRoutes from "./routes/repository.routes.js";
import repositoryFileRoutes from "./routes/repository-file.routes.js";
import branchRoutes from "./routes/branch.routes.js";
import fileContentRoutes from "./routes/file-content.routes.js";

dotenv.config();

const app = express();

app.use(
    cors({
        origin: process.env.FRONTEND_URL,
        credentials: true
    })
);
app.use(express.json());
app.use(cookieParser());
app.use("/api/auth", authRoutes)
app.use("/api/repositories", repositoryRoutes);
app.use("/api/repositories", repositoryFileRoutes);
app.use("/api/repositories", branchRoutes);
app.use("/api/repositories", fileContentRoutes);

app.get("/api/health", async (req, res) => {
    try {
        const users = await prisma.user.findMany();

        res.json({
            status: "success",
            database: "connected",
            usersCount: users.length
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            status: "error",
            database: "disconnected"
        });
    }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});