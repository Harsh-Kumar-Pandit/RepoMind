import { Octokit } from "octokit";

const GITHUB_URL_REGEX =
  /^https:\/\/github\.com\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9_.-]+)\/?$/;

export function parseGitHubUrl(url) {
  if (typeof url !== "string") {
    throw new Error("GitHub repository URL is required");
  }

  const match = url.trim().match(GITHUB_URL_REGEX);

  if (!match) {
    throw new Error(
      "Enter a valid URL like https://github.com/facebook/react"
    );
  }

  const [, owner, rawRepo] = match;
  const repo = rawRepo.replace(/\.git$/, "");

  if (!repo || repo === "." || repo === "..") {
    throw new Error("Invalid repository name");
  }

  return { owner, repo };
}

function createGitHubClient(accessToken) {
  return new Octokit(accessToken ? { auth: accessToken } : {});
}

export async function getRepository(owner, repo, accessToken) {
  const octokit = createGitHubClient(accessToken);

  const { data } = await octokit.rest.repos.get({
    owner,
    repo,
  });

  return {
  id: data.id,
  owner: data.owner.login,
  name: data.name,
  fullName: data.full_name,
  url: data.html_url,
  description: data.description,
  defaultBranch: data.default_branch,
  sizeKB: data.size,
  visibility: data.visibility,
  archived: data.archived,
  };
}

export async function getRepositoryTree(
  owner,
  repo,
  branch,
  accessToken
) {
  const octokit = createGitHubClient(accessToken);

  const { data } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: branch,
    recursive: "true",
  });

  return {
    truncated: data.truncated,
    files: data.tree.map((item) => ({
      path: item.path,
      type: item.type,
      size: item.size ?? 0,
      sha: item.sha,
    })),
  };
}