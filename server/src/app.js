import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import prisma from "./db/prisma.js";
import authRoutes from "./routes/auth.routes.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes)

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