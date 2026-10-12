import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getAuthenticatedUser, initiateGitHubLogin, logoutUser } from "../services/auth.service.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const checkAuth = useCallback(async () => {
    try {
      setError(null);
      const currentUser = await getAuthenticatedUser();
      setUser(currentUser);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    getAuthenticatedUser()
      .then((currentUser) => {
        if (isMounted) setUser(currentUser);
      })
      .catch(() => {
        if (isMounted) setUser(null);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  async function logout() {
    try {
      await logoutUser();
      setUser(null);
    } catch (err) {
      console.error("Logout failed:", err);
      setUser(null);
    }
  }

  function login(redirectTo = "/") {
    initiateGitHubLogin(redirectTo);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        isAuthenticated: Boolean(user),
        login,
        logout,
        refreshUser: checkAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
