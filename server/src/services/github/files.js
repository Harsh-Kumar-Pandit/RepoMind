import { createGithubClient } from "./githubClient.js";

export const getRepositoryTree = async (
    accessToken,
    owner,
    repo,
    branch
) => {
    const octokit = createGithubClient(accessToken);

    const repository = await octokit.rest.repos.get({
        owner,
        repo
    });

    const targetBranch = branch || repository.data.default_branch;

    const branchResponse = await octokit.rest.repos.getBranch({
        owner,
        repo,
        branch: targetBranch
    });

    const treeSha = branchResponse.data.commit.commit.tree.sha;

    const response = await octokit.rest.git.getTree({
        owner,
        repo,
        tree_sha: treeSha,
        recursive: "true"
    });

    return {
        branch: targetBranch,
        tree: response.data.tree
    };
};