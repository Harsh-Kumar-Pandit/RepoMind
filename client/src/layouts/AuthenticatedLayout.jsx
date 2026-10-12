import { Outlet, NavLink, Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";
import {
  Home,
  FolderGit2,
  Code2,
  MessageSquare,
  GitPullRequest,
  History,
  Settings,
  LogOut,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import Button from "../components/ui/Button.jsx";
import LoadingSpinner from "../components/shared/Loading.jsx";

export function AuthenticatedLayout() {
  const { user, loading, logout, login } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F8F6]">
        <LoadingSpinner label="Authenticating session..." />
      </div>
    );
  }

  // Not authenticated fallback
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#F8F8F6] text-center">
        <div className="max-w-md w-full bg-white p-6 rounded-md border border-[#E5E5E2] shadow-xs">
          <h2 className="text-base font-semibold text-[#202124]">Authentication Required</h2>
          <p className="text-xs text-[#5F6368] mt-2 mb-6">
            You must be signed in with GitHub to access workspaces and repository features.
          </p>
          <Button onClick={() => login("/app")} className="w-full">
            Sign In with GitHub
          </Button>
          <div className="mt-4">
            <Link to="/" className="text-xs text-[#6D5CE8] hover:underline">
              Return to Landing Page
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const navItems = [
    { label: "Home", to: "/app", icon: Home, end: true },
    { label: "Repositories", to: "/app/repositories", icon: FolderGit2 },
    { label: "Workspaces", to: "/app/workspaces", icon: Code2 },
    { label: "Chat", to: "/app/chat", icon: MessageSquare },
    { label: "Pull Requests", to: "/app/pull-requests", icon: GitPullRequest },
    { label: "History", to: "/app/history", icon: History },
    { label: "Settings", to: "/app/settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen flex bg-[#F8F8F6] text-[#202124]">
      {/* Graphite Sidebar (230px) */}
      <aside className="w-56 bg-[#17191D] text-[#D1D5DB] flex flex-col shrink-0 select-none border-r border-[#2A2E35]">
        {/* Workspace Brand / Header */}
        <div className="h-14 px-4 flex items-center gap-2.5 border-b border-[#2A2E35]">
          <div className="w-6 h-6 rounded bg-[#6D5CE8] flex items-center justify-center text-white text-xs font-mono font-bold">
            R
          </div>
          <span className="font-semibold text-white tracking-tight text-sm">RepoMind</span>
        </div>

        {/* Navigation List */}
        <nav className="flex-1 px-2.5 py-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-[#2A2E35] text-white font-semibold"
                      : "text-[#9CA3AF] hover:text-white hover:bg-[#20242B]"
                  }`
                }
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Footer Account Profile */}
        <div className="p-3 border-t border-[#2A2E35] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.login}
                className="w-7 h-7 rounded-full bg-[#2A2E35] shrink-0"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-[#6D5CE8] text-white flex items-center justify-center text-xs font-bold shrink-0">
                {user.login?.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-medium text-white truncate">{user.name || user.login}</p>
              <p className="text-[10px] text-[#80868B] truncate font-mono">@{user.login}</p>
            </div>
          </div>

          <button
            onClick={logout}
            title="Log Out"
            className="text-[#9CA3AF] hover:text-white p-1 rounded hover:bg-[#20242B]"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </aside>

      {/* Main Shell Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Contextual Header Bar */}
        <header className="h-14 border-b border-[#E5E5E2] bg-white px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs text-[#5F6368]">
            <Link to="/app" className="hover:text-[#202124]">
              RepoMind
            </Link>
            <ChevronRight className="w-3.5 h-3.5 text-[#80868B]" />
            <span className="text-[#202124] font-medium">Dashboard</span>
          </div>

          <div className="flex items-center gap-3">
            <Link to="/design-system" className="text-xs text-[#5F6368] hover:text-[#202124]">
              UI Specs
            </Link>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#5F6368] hover:text-[#202124] flex items-center gap-1"
            >
              <span>GitHub</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </header>

        {/* Content Outlet */}
        <main className="flex-1 p-6 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default AuthenticatedLayout;
