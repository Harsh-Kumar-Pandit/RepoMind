import { Router } from "express";
import {
  parseGitHubUrl,
  getRepository,
  getRepositoryTree,
} from "../services/github.service.js";

const router = Router();

router.post("/analyze", async (req, res) => {
  try {
    const { url } = req.body;
    const { owner, repo } = parseGitHubUrl(url);

    // Public repositories work without login.
    // Private repositories require a valid authorized token.
    const accessToken = req.session?.githubAccessToken;

    const repository = await getRepository(
      owner,
      repo,
      accessToken
    );

    // Initial MVP size guardrail: 50 MB GitHub-reported repository size.

    const tree = await getRepositoryTree(
      owner,
      repo,
      repository.defaultBranch,
      accessToken
    );

    return res.json({
      repository,
      tree: tree.files,
      truncated: tree.truncated,
      message: tree.truncated
        ? "File tree is incomplete because GitHub truncated the response."
        : "Repository fetched successfully.",
    });
  } catch (error) {
    const status =
      error.status === 404 ? 404 :
      error.status === 401 || error.status === 403 ? error.status :
      error.message?.includes("valid URL") ||
      error.message?.includes("URL is required") ||
      error.message?.includes("Invalid repository")
        ? 400
        : 502;

    return res.status(status).json({
      message:
        status === 404
          ? "Repository not found or inaccessible."
          : status === 401 || status === 403
            ? "GitHub authorization failed or access was denied."
            : error.message || "Failed to analyze repository.",
    });
  }
});

export default router;