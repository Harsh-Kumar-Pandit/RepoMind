
import express from "express";
import prisma from "../db/prisma.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getRepositoryTree } from "../services/github/files.js";

const router = express.Router();

router.get("/:owner/:repo/tree", requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { branch } = req.query;

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

        const result = await getRepositoryTree(
            user.accessToken,
            owner,
            repo,
            branch
        );

        res.json({
            owner,
            repo,
            branch: result.branch,
            tree: result.tree
        });
    } catch (error) {
        console.error(
            "Get repository tree error:",
            error.response?.data || error.message
        );

        res.status(500).json({
            message: "Failed to fetch repository tree"
        });
    }
});

export default router;