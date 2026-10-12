import { Outlet, Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";
import Button from "../components/ui/Button.jsx";
import { GitPullRequest, LogIn } from "lucide-react";

export function PublicLayout() {
  const { user, login } = useAuth();

  return (
    <div className="min-h-screen flex flex-col bg-[#F8F8F6] text-[#202124]">
      {/* Header */}
      <header className="border-b border-[#E5E5E2] bg-white sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-[#202124] no-underline font-semibold">
            <div className="w-6 h-6 rounded bg-[#17191D] flex items-center justify-center text-white text-xs font-mono font-bold">
              R
            </div>
            <span className="text-base tracking-tight font-bold">RepoMind</span>
          </Link>

          <nav className="flex items-center gap-3">
            <Link to="/design-system" className="text-xs text-[#5F6368] hover:text-[#202124] px-2 py-1">
              Design System
            </Link>
            {user ? (
              <Link to="/app">
                <Button size="sm" variant="default">
                  Open App
                </Button>
              </Link>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => login("/")} className="gap-1.5">
                <LogIn className="w-3.5 h-3.5" />
                <span>Sign in with GitHub</span>
              </Button>
            )}
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-[#E5E5E2] bg-white py-6">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#80868B]">
          <div className="flex items-center gap-2">
            <GitPullRequest className="w-4 h-4 text-[#6D5CE8]" />
            <span>RepoMind — Understand codebases, edit with confidence.</span>
          </div>
          <div>Strict AI explanation. Manual user editing. Pinned version control.</div>
        </div>
      </footer>
    </div>
  );
}

export default PublicLayout;
