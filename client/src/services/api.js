import axios from "axios";

/**
 * Centralized Axios instance configured for RepoMind backend.
 * Uses withCredentials=true so HttpOnly session cookies (repomind_session)
 * and OAuth state cookies are automatically sent and received.
 */
export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api",
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 30000,
});

// Response interceptor for consistent error extraction
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Standardize error message extraction from AppError response envelope
    const serverMessage = error.response?.data?.error?.message;
    const serverCode = error.response?.data?.error?.code;
    const status = error.response?.status;

    if (serverMessage) {
      error.customMessage = serverMessage;
      error.code = serverCode;
    }

    // Handle 401 Unauthorized redirect when necessary
    if (status === 401 && !error.config?.url?.includes("/auth/me")) {
      // Session has expired or is invalid
      console.warn("Unauthenticated request:", error.config?.url);
    }

    return Promise.reject(error);
  }
);

export default apiClient;
