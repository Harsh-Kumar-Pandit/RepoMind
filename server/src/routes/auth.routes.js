import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";


import {
    getGithubAuthorizationUrl,
    exchangeCodeForToken,
    getGithubUser
} from "../services/auth/githubAuth.js";
import prisma from "../db/prisma.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/me", requireAuth, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: {
                id: req.userId
            },
            select: {
                id: true,
                githubId: true,
                username: true,
                avatar: true,
                createdAt: true
            }
        });

        if (!user) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        res.json({
            user
        });
    } catch (error) {
        console.error("Get current user error:", error);

        res.status(500).json({
            message: "Failed to get current user"
        });
    }
});

router.get("/github/callback", async (req, res) => {
    try {
        const { code, state } = req.query;

        if (!code || !state) {
            return res.status(400).json({
                message: "Missing authorization code or state"
            });
        }

        if (state !== req.cookies.oauth_state) {
            return res.status(400).json({
                message: "Invalid OAuth state"
            });
        }

        res.clearCookie("oauth_state");

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

        const token = jwt.sign(
            {
                userId: user.id
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "7d"
            }
        );

        res.cookie("token", token, {
            httpOnly: true,
            secure: false,
            sameSite: "lax",
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        console.log("User logged in:", user.username);

        res.redirect(`${process.env.FRONTEND_URL}/dashboard`);

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
    const state = crypto.randomBytes(32).toString("hex");

    res.cookie("oauth_state", state, {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        maxAge: 10 * 60 * 1000
    });

    const githubUrl = getGithubAuthorizationUrl(state);

    res.redirect(githubUrl);
});

router.post("/logout", (req, res) => {
    res.clearCookie("token");

    res.json({
        message: "Logged out successfully"
    });
});

export default router;