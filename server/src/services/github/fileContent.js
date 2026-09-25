import { createGithubClient } from "./githubClient.js";

export const getRepositoryFile = async (
    accessToken,
    owner,
    repo,
    path,
    branch
) => {
    const octokit = createGithubClient(accessToken);

    const response = await octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref: branch
    });

    if (Array.isArray(response.data)) {
        throw new Error("The requested path is a directory");
    }

    const content = Buffer.from(
        response.data.content,
        "base64"
    ).toString("utf-8");

    return {
        path: response.data.path,
        sha: response.data.sha,
        content
    };
};