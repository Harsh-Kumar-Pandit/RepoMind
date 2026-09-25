import { createGithubClient } from "./githubClient.js";

export const getUserRepositories = async (accessToken) => {
    const octokit = createGithubClient(accessToken);

    const response = await octokit.rest.repos.listForAuthenticatedUser({
        per_page: 100,
        sort: "updated",
        direction: "desc"
    });

    return response.data.map((repo) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        private: repo.private,
        defaultBranch: repo.default_branch,
        description: repo.description
    }));
};