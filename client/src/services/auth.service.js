import apiClient from "./api.js";

/**
 * Authentication Service
 * Endpoints for GitHub OAuth and session inspection.
 */
export async function getAuthenticatedUser() {
  const { data } = await apiClient.get("/auth/me");
  return data?.data?.user;
}

export function initiateGitHubLogin(redirectTo = "/") {
  const baseURL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";
  const authUrl = `${baseURL}/auth/github?redirectTo=${encodeURIComponent(redirectTo)}`;
  window.location.href = authUrl;
}

export async function logoutUser() {
  const { data } = await apiClient.post("/auth/logout");
  return data;
}

export default {
  getAuthenticatedUser,
  initiateGitHubLogin,
  logoutUser,
};
