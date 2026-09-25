import express from "express";
import prisma from "../db/prisma.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getRepositoryBranches } from "../services/github/branches.js";

const router = express.Router();

router.get("/:owner/:repo/branches", requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;

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

        const branches = await getRepositoryBranches(
            user.accessToken,
            owner,
            repo
        );

        res.json({
            owner,
            repo,
            branches
        });
    } catch (error) {
        console.error(
            "Get repository branches error:",
            error.response?.data || error.message
        );

        res.status(500).json({
            message: "Failed to fetch repository branches"
        });
    }
});

export default router;