import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../contexts/AuthContext.jsx";
import { listUserRepositories, analyzeRepository } from "../services/repository.service.js";
import { formatActionableErrorMessage } from "../lib/utils.js";
import Button from "../components/ui/Button.jsx";
import Input from "../components/ui/Input.jsx";
import { Card, CardHeader, CardContent } from "../components/ui/Card.jsx";
import Badge from "../components/ui/Badge.jsx";
import { EmptyState } from "../components/shared/EmptyState.jsx";
import { LoadingSpinner } from "../components/shared/Loading.jsx";
import { FolderGit2, ArrowRight, ExternalLink, Sparkles, BookOpen, Clock } from "lucide-react";

export function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [repoUrl, setRepoUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");

  const { data: repositories = [], isLoading } = useQuery({
    queryKey: ["user-repositories"],
    queryFn: listUserRepositories,
  });

  async function handleAnalyze(e) {
    e.preventDefault();
    if (!repoUrl.trim()) {
      setError("Please enter a GitHub repository URL.");
      return;
    }

    if (!repoUrl.startsWith("https://github.com/")) {
      setError("Only HTTPS GitHub repository URLs are supported.");
      return;
    }

    setAnalyzing(true);
    setError("");

    try {
      const data = await analyzeRepository(repoUrl.trim());
      // Navigate to repository overview with state
      navigate(`/app/repositories/${data.repository.id}`, {
        state: { analysisData: data },
      });
    } catch (err) {
      setError(
        formatActionableErrorMessage(
          err,
          "Failed to analyze repository. Verify URL and permissions."
        )
      );
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-8">
      {/* Welcome Banner */}
      <div className="border border-[#E5E5E2] bg-white rounded-md p-6">
        <h1 className="text-xl font-bold text-[#202124]">
          Welcome, {user?.name || user?.login}
        </h1>
        <p className="text-xs text-[#5F6368] mt-1 max-w-xl">
          RepoMind is your workspace for understanding codebases with AI-grounded explanations,
          exploring files, and editing with Optimistic Concurrency Control.
        </p>

        {/* Quick URL Input */}
        <form onSubmit={handleAnalyze} className="mt-5 flex flex-col sm:flex-row gap-2 max-w-2xl">
          <Input
            type="url"
            placeholder="https://github.com/owner/repository"
            value={repoUrl}
            onChange={(e) => {
              setRepoUrl(e.target.value);
              if (error) setError("");
            }}
            className="font-mono text-xs"
            error={Boolean(error)}
          />
          <Button type="submit" loading={analyzing} className="shrink-0 gap-1.5 text-xs">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Analyze Repository</span>
          </Button>
        </form>

        {error && <p className="text-xs text-[#C84C4C] mt-2">{error}</p>}
      </div>

      {/* Repositories Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-[#202124]">Your Analyzed Repositories</h2>
            <p className="text-xs text-[#5F6368]">
              Repositories you own or collaborate on with indexed code snapshots.
            </p>
          </div>
          <Link to="/app/repositories">
            <Button variant="ghost" size="sm" className="text-xs gap-1">
              <span>View All</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="p-8 border border-[#E5E5E2] rounded-md bg-white">
            <LoadingSpinner label="Loading your repositories..." />
          </div>
        ) : repositories.length === 0 ? (
          <EmptyState
            icon={FolderGit2}
            title="No repositories analyzed yet"
            description="Enter a GitHub repository URL above to inspect architecture, index code embeddings, and open an editable workspace."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {repositories.slice(0, 4).map((repo) => {
              const snapshot = repo.latestSnapshot;

              return (
                <Card key={repo.id} className="hover:border-[#D1D1CD] transition-colors">
                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link
                          to={`/app/repositories/${repo.id}`}
                          className="text-sm font-semibold text-[#202124] hover:text-[#6D5CE8] truncate block"
                        >
                          {repo.owner}/{repo.name}
                        </Link>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="default" className="text-[10px] py-0">
                            {repo.defaultBranch}
                          </Badge>
                          <Badge variant={repo.role === "OWNER" ? "violet" : "default"} className="text-[10px] py-0">
                            {repo.role}
                          </Badge>
                          {snapshot && (
                            <Badge
                              variant={
                                snapshot.status === "COMPLETED"
                                  ? "success"
                                  : snapshot.status === "FAILED"
                                  ? "danger"
                                  : "warning"
                              }
                              className="text-[10px] py-0"
                            >
                              {snapshot.status}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <a
                        href={repo.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#80868B] hover:text-[#202124] p-1"
                        title="View on GitHub"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </CardHeader>

                  <CardContent className="p-4 pt-2">
                    <div className="flex items-center justify-between text-xs text-[#5F6368] pt-2 border-t border-[#E5E5E2]/50 mt-2">
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <Clock className="w-3 h-3 text-[#80868B]" />
                        <span>Added {new Date(repo.createdAt).toLocaleDateString()}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <Link to={`/app/explorer/${repo.id}`}>
                          <Button variant="ghost" size="sm" className="h-7 text-xs px-2 gap-1">
                            <BookOpen className="w-3 h-3" />
                            <span>Explorer</span>
                          </Button>
                        </Link>
                        <Link to={`/app/repositories/${repo.id}`}>
                          <Button variant="secondary" size="sm" className="h-7 text-xs px-2">
                            Overview
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default HomePage;
