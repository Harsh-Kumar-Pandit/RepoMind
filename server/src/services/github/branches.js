import { createGithubClient } from "./githubClient.js";

export const getRepositoryBranches = async (
    accessToken,
    owner,
    repo
) => {
    const octokit = createGithubClient(accessToken);

    const response = await octokit.rest.repos.listBranches({
        owner,
        repo,
        per_page: 100
    });

    return response.data.map((branch) => ({
        name: branch.name,
        protected: branch.protected
    }));
};