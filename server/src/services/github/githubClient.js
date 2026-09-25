import { Octokit } from "octokit";

export const createGithubClient = (accessToken) => {
    return new Octokit({
        auth: accessToken
    });
};