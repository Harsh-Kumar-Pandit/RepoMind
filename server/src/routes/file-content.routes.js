import express from "express";
import prisma from "../db/prisma.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getRepositoryFile } from "../services/github/fileContent.js";

const router = express.Router();

router.get("/:owner/:repo/file", requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { path, branch } = req.query;

        if (!path) {
            return res.status(400).json({
                message: "File path is required"
            });
        }

        if (!branch) {
            return res.status(400).json({
                message: "Branch is required"
            });
        }

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

        const file = await getRepositoryFile(
            user.accessToken,
            owner,
            repo,
            path,
            branch
        );

        res.json(file);
    } catch (error) {
        console.error(
            "Get repository file error:",
            error.response?.data || error.message
        );

        res.status(500).json({
            message: "Failed to fetch repository file"
        });
    }
});

export default router;