import express from "express";
import crypto from "crypto";

import {
    getGithubAuthorizationUrl,
    exchangeCodeForToken,
    getGithubUser
} from "../services/auth/githubAuth.js";
import prisma from "../db/prisma.js";

const router = express.Router();

router.get("/github/callback", async (req, res) => {
    try {
        const { code } = req.query;

        if (!code) {
            return res.status(400).json({
                message: "Authorization code is missing"
            });
        }

        const accessToken = await exchangeCodeForToken(code);

        const githubUser = await getGithubUser(accessToken);

        const user = await prisma.user.upsert({
            where: {
                githubId: String(githubUser.id)
            },
            update: {
                username: githubUser.login,
                avatar: githubUser.avatar_url,
                accessToken
            },
            create: {
                githubId: String(githubUser.id),
                username: githubUser.login,
                avatar: githubUser.avatar_url,
                accessToken
            }
        });

        console.log("User saved:", user.username);

        res.json({
            message: "GitHub OAuth successful",
            user: {
                id: user.id,
                githubId: user.githubId,
                username: user.username,
                avatar: user.avatar
            }
        });
    } catch (error) {
        console.error(
            "GitHub OAuth error:",
            error.response?.data || error.message
        );

        res.status(500).json({
            message: "GitHub authentication failed"
        });
    }
});

router.get("/github", (req, res) => {
    const state = crypto.randomBytes(32).toString("hex")

    const githubUrl = getGithubAuthorizationUrl(state)

    res.redirect(githubUrl)
})

export default router;