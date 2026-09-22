import axios from "axios"
import dotenv from "dotenv"

export const getGithubAuthorizationUrl = (state) => {
    const params = new URLSearchParams({
        client_id: process.env.GITHUB_CLIENT_ID,
        redirect_uri: process.env.GITHUB_CALLBACK_URL,
        scope: "repo read:user",
        state
    });

    return `https://github.com/login/oauth/authorize?${params.toString()}`;
};

export const exchangeCodeForToken = async (code) => {
    const response = await axios.post(
        "https://github.com/login/oauth/access_token",
        {
            client_id: process.env.GITHUB_CLIENT_ID,
            client_secret: process.env.GITHUB_CLIENT_SECRET,
            code,
            redirect_uri: process.env.GITHUB_CALLBACK_URL
        },
        {
            headers: {
                Accept: "application/json"
            }
        }
    );

    return response.data.access_token;
};

export const getGithubUser = async (accessToken) => {
    const response = await axios.get(
        "https://api.github.com/user",
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/vnd.github+json"
            }
        }
    );

    return response.data;
};