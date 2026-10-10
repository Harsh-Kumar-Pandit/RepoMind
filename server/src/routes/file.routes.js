import { Router } from "express";
import { Octokit } from "octokit";
import {
  parseGitHubUrl,
} from "../services/github.service.js";

const router = Router();

router.post("/read", async (req, res) => {
  try {
    const { url, path } = req.body;

    const { owner, repo } = parseGitHubUrl(url);

    if (
      typeof path !== "string" ||
      !path.trim() ||
      path.includes("..") ||
      path.startsWith("/")
    ) {
      return res.status(400).json({
        message: "Invalid file path",
      });
    }

    const octokit = new Octokit();

    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
    });

    if (Array.isArray(data) || data.type !== "file") {
      return res.status(400).json({
        message: "Select a file, not a directory",
      });
    }

    if (data.size > 1024 * 1024) {
      return res.status(413).json({
        message: "File exceeds the 1 MB reading limit",
      });
    }

    const content = Buffer.from(
      data.content,
      "base64"
    ).toString("utf8");

    res.json({
      path: data.path,
      size: data.size,
      content,
    });
  } catch (error) {
    res.status(error.status || 500).json({
      message: "Unable to read repository file",
    });
  }
});

export default router;