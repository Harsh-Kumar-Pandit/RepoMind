import express from "express";
import prisma from "../db/prisma.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getUserRepositories } from "../services/github/repositories.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: {
                id: req.userId
            },
            select: {
                accessToken: true
            }
        });

        if (!user) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        const repositories = await getUserRepositories(user.accessToken);

        res.json({
            repositories
        });
    } catch (error) {
        console.error(
            "Get repositories error:",
            error.response?.data || error.message
        );

        res.status(500).json({
            message: "Failed to fetch repositories"
        });
    }
});

export default router;