import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";
import Button from "../components/ui/Button.jsx";
import Input from "../components/ui/Input.jsx";
import { Card, CardContent } from "../components/ui/Card.jsx";
import { BookOpen, Code2, GitPullRequest, ArrowRight } from "lucide-react";

export function LandingPage() {
  const [repoUrl, setRepoUrl] = useState("");
  const [error, setError] = useState("");
  const { user, login } = useAuth();
  const navigate = useNavigate();

  function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!repoUrl.trim()) {
      setError("Please enter a valid GitHub repository URL.");
      return;
    }

    if (!repoUrl.startsWith("https://github.com/")) {
      setError("Only HTTPS GitHub repository URLs are supported (e.g. https://github.com/owner/repo).");
      return;
    }

    // Navigate to analyze in dashboard
    if (user) {
      navigate(`/app/repositories?url=${encodeURIComponent(repoUrl.trim())}`);
    } else {
      login(`/app/repositories?url=${encodeURIComponent(repoUrl.trim())}`);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 md:py-20 text-center">
      {/* Hero Header */}
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#E5E5E2]/50 text-xs font-mono text-[#5F6368] mb-2 border border-[#E5E5E2]">
          <span>RepoMind v1.0</span>
          <span>•</span>
          <span>Read-Only AI Explorer & Manual Workspace</span>
        </div>

        <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-[#202124] leading-tight">
          Understand your codebase. <br />
          Make changes with confidence.
        </h1>

        <p className="text-sm md:text-base text-[#5F6368] max-w-xl mx-auto leading-relaxed">
          AI explains complex architectures using grounded RAG citations. You manually edit, preview
          unified diffs, create checkpoints, and publish reviewed pull requests to GitHub.
        </p>
      </div>

      {/* Primary Repository Input Call-to-Action */}
      <div className="w-full max-w-xl mx-auto mt-8">
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
          <Input
            type="url"
            placeholder="https://github.com/owner/repository"
            value={repoUrl}
            onChange={(e) => {
              setRepoUrl(e.target.value);
              if (error) setError("");
            }}
            className="h-11 text-sm bg-white border-[#E5E5E2] px-4 font-mono"
            error={Boolean(error)}
          />

          <Button type="submit" size="lg" className="h-11 px-6 shrink-0 gap-2">
            <span>Analyze Repository</span>
            <ArrowRight className="w-4 h-4" />
          </Button>
        </form>

        {error && <p className="text-xs text-[#C84C4C] text-left mt-2 pl-1">{error}</p>}

        <p className="text-[11px] text-[#80868B] text-left mt-2 pl-1">
          Try any public GitHub repository. Private repositories require server token authorization.
        </p>
      </div>

      {/* Core Benefits */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto mt-20 text-left">
        <Card>
          <CardContent className="p-6">
            <div className="w-9 h-9 rounded bg-[#6D5CE8]/10 text-[#6D5CE8] flex items-center justify-center mb-3">
              <BookOpen className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-[#202124]">1. Understand Code</h3>
            <p className="text-xs text-[#5F6368] mt-2 leading-relaxed">
              Ask questions about any repository. AI provides grounded answers referencing exact code
              snippets and line ranges via pgvector RAG.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="w-9 h-9 rounded bg-[#25845B]/10 text-[#25845B] flex items-center justify-center mb-3">
              <Code2 className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-[#202124]">2. Explore & Edit</h3>
            <p className="text-xs text-[#5F6368] mt-2 leading-relaxed">
              Browse the read-only tree or open an editable workspace. Save with Optimistic Concurrency
              Control and create point-in-time checkpoints.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="w-9 h-9 rounded bg-[#17191D]/10 text-[#202124] flex items-center justify-center mb-3">
              <GitPullRequest className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-[#202124]">3. Review & Publish</h3>
            <p className="text-xs text-[#5F6368] mt-2 leading-relaxed">
              Review standard unified diffs against pinned base commit SHAs. Explicitly publish selected
              changes to a branch and create pull requests.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default LandingPage;
