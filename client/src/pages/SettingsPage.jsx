import { useState } from "react";
import { useAuth } from "../contexts/AuthContext.jsx";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";
import Badge from "../components/ui/Badge.jsx";
import Notification from "../components/ui/Notification.jsx";
import {
  Settings,
  User,
  Shield,
  LogOut,
  Sun,
  Moon,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";

/**
 * SettingsPage
 * Surfaces authentic user session profile, authentication state,
 * secure logout flow, and interface preferences.
 * Does NOT accept API keys or expose server tokens in localStorage.
 */
export function SettingsPage() {
  const { user, logout, loading } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("repomind_theme") || "light";
  });
  const [themeSaved, setThemeSaved] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
      window.location.href = "/";
    } catch (err) {
      console.error("Logout failed:", err);
      setLoggingOut(false);
    }
  }

  function handleThemeToggle(newTheme) {
    setTheme(newTheme);
    localStorage.setItem("repomind_theme", newTheme);
    setThemeSaved(true);
    setTimeout(() => setThemeSaved(false), 2000);
  }

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-[#202124] flex items-center gap-2">
          <Settings className="w-5 h-5 text-[#6D5CE8]" />
          <span>Account & Settings</span>
        </h1>
        <p className="text-xs text-[#5F6368] mt-1">
          Review authenticated GitHub profile details, active session security, and interface preferences.
        </p>
      </div>

      {themeSaved && (
        <Notification variant="success" title="Preference Saved">
          Interface display preference updated to {theme} mode.
        </Notification>
      )}

      {/* GitHub Profile Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-[#6D5CE8]" />
            <CardTitle>GitHub Profile</CardTitle>
          </div>
          <CardDescription>
            Identity details provided during GitHub OAuth sign-in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-xs">
          <div className="flex items-center gap-4">
            {user?.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.login}
                className="w-14 h-14 rounded-full border border-[#E5E5E2] bg-[#F8F8F6]"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-[#6D5CE8]/10 text-[#6D5CE8] flex items-center justify-center font-bold text-lg">
                {user?.login?.[0]?.toUpperCase() || "U"}
              </div>
            )}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-[#202124]">{user?.name || user?.login}</span>
                <Badge variant="default" className="text-[10px] font-mono">
                  @{user?.login}
                </Badge>
              </div>
              <p className="text-[#5F6368] font-mono text-[11px]">
                {user?.email || "No public email returned by GitHub"}
              </p>
              <a
                href={`https://github.com/${user?.login}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#6D5CE8] text-[11px] font-medium hover:underline inline-flex items-center gap-1 pt-0.5"
              >
                <span>View GitHub Profile</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-[#E5E5E2] font-mono text-[11px]">
            <div className="p-2.5 rounded bg-[#F8F8F6] border border-[#E5E5E2]">
              <span className="text-[#80868B] block">User ID:</span>
              <span className="text-[#202124] font-medium truncate block">{user?.id || "—"}</span>
            </div>
            <div className="p-2.5 rounded bg-[#F8F8F6] border border-[#E5E5E2]">
              <span className="text-[#80868B] block">GitHub UID:</span>
              <span className="text-[#202124] font-medium truncate block">{user?.githubId || "—"}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Security & Authentication Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#25845B]" />
            <CardTitle>Session Security</CardTitle>
          </div>
          <CardDescription>
            Session token lifecycle and credentials safeguarding.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          <div className="p-3 bg-[#F8F8F6] rounded-md border border-[#E5E5E2] space-y-2 text-[#5F6368]">
            <div className="flex items-center gap-1.5 font-bold text-[#202124]">
              <CheckCircle2 className="w-4 h-4 text-[#25845B]" />
              <span>HttpOnly Cookie Session Protection</span>
            </div>
            <p>
              Your authenticated session is governed by an encrypted <code>repomind_session</code> cookie marked with <code>HttpOnly</code>, <code>SameSite=Lax</code>, and <code>Secure</code>.
            </p>
            <p>
              No GitHub access tokens or session keys are ever accessible to client JavaScript, browser extensions, or <code>localStorage</code>.
            </p>
          </div>

          <div className="pt-2 flex justify-between items-center">
            <div>
              <span className="font-bold text-[#202124] block">Sign Out</span>
              <span className="text-[#5F6368] text-[11px]">
                Revokes your server-side session token in PostgreSQL and clears the session cookie.
              </span>
            </div>
            <Button
              variant="destructive"
              size="sm"
              loading={loggingOut}
              disabled={loading}
              onClick={handleLogout}
              className="gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Interface Preferences */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sun className="w-4 h-4 text-[#D97706]" />
            <CardTitle>Theme & Appearance</CardTitle>
          </div>
          <CardDescription>
            Configure developer console visual appearance.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-xs space-y-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleThemeToggle("light")}
              className={`px-3 py-2 rounded-md border text-xs flex items-center gap-2 transition-colors ${
                theme === "light"
                  ? "border-[#6D5CE8] bg-[#6D5CE8]/5 text-[#6D5CE8] font-bold"
                  : "border-[#E5E5E2] bg-white text-[#5F6368] hover:bg-[#F8F8F6]"
              }`}
            >
              <Sun className="w-4 h-4" />
              <span>Light Mode (Default)</span>
            </button>

            <button
              onClick={() => handleThemeToggle("dark")}
              className={`px-3 py-2 rounded-md border text-xs flex items-center gap-2 transition-colors ${
                theme === "dark"
                  ? "border-[#6D5CE8] bg-[#6D5CE8]/5 text-[#6D5CE8] font-bold"
                  : "border-[#E5E5E2] bg-white text-[#5F6368] hover:bg-[#F8F8F6]"
              }`}
            >
              <Moon className="w-4 h-4" />
              <span>Dark Mode (Console)</span>
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default SettingsPage;
