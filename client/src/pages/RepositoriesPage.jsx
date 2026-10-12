import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { listUserRepositories, analyzeRepository } from "../services/repository.service.js";
import { formatActionableErrorMessage } from "../lib/utils.js";
import Button from "../components/ui/Button.jsx";
import Input from "../components/ui/Input.jsx";
import { Card, CardHeader, CardContent } from "../components/ui/Card.jsx";
import Badge from "../components/ui/Badge.jsx";
import { EmptyState } from "../components/shared/EmptyState.jsx";
import { LoadingSpinner } from "../components/shared/Loading.jsx";
import { FolderGit2, ExternalLink, Sparkles, BookOpen, MessageSquare, Code2, Plus } from "lucide-react";

export function RepositoriesPage() {
  const [searchParams] = useSearchParams();
  const initialUrl = searchParams.get("url") || "";

  const [repoUrl, setRepoUrl] = useState(initialUrl);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [showAddForm, setShowAddForm] = useState(Boolean(initialUrl));

  const {
    data: repositories = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["user-repositories"],
    queryFn: listUserRepositories,
  });

  async function handleAnalyze(e) {
    e.preventDefault();
    if (!repoUrl.trim()) {
      setError("Please enter a valid GitHub repository URL.");
      return;
    }

    if (!repoUrl.startsWith("https://github.com/")) {
      setError("Only HTTPS GitHub repository URLs are supported.");
      return;
    }

    setAnalyzing(true);
    setError("");

    try {
      await analyzeRepository(repoUrl.trim());
      await refetch();
      setRepoUrl("");
      setShowAddForm(false);
    } catch (err) {
      setError(
        formatActionableErrorMessage(
          err,
          "Failed to analyze repository."
        )
      );
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header and Add Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#202124]">Repositories</h1>
          <p className="text-xs text-[#5F6368] mt-1">
            Manage your analyzed codebases, index snapshots, and launch workspaces.
          </p>
        </div>

        {!showAddForm && (
          <Button size="sm" onClick={() => setShowAddForm(true)} className="gap-1.5 self-start">
            <Plus className="w-4 h-4" />
            <span>Analyze New Repo</span>
          </Button>
        )}
      </div>

      {/* Analysis Drawer / Form */}
      {showAddForm && (
        <Card className="border-[#6D5CE8]/30 bg-white">
          <CardHeader className="p-4 pb-2 flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#6D5CE8]" />
              <h3 className="text-xs font-bold text-[#202124]">Analyze GitHub Repository</h3>
            </div>
            <button
              onClick={() => {
                setShowAddForm(false);
                setError("");
              }}
              className="text-xs text-[#80868B] hover:text-[#202124]"
            >
              Cancel
            </button>
          </CardHeader>

          <CardContent className="p-4 pt-2">
            <form onSubmit={handleAnalyze} className="flex flex-col sm:flex-row gap-2">
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
              <Button type="submit" loading={analyzing} className="shrink-0 text-xs">
                Analyze
              </Button>
            </form>
            {error && <p className="text-xs text-[#C84C4C] mt-2">{error}</p>}
          </CardContent>
        </Card>
      )}

      {/* Repositories List */}
      {isLoading ? (
        <div className="p-12 border border-[#E5E5E2] rounded-md bg-white">
          <LoadingSpinner label="Fetching your repositories..." />
        </div>
      ) : repositories.length === 0 ? (
        <EmptyState
          icon={FolderGit2}
          title="No repositories found"
          description="Analyze your first GitHub repository to view its file tree, ask grounded AI questions, and create manual workspaces."
          actionText="Analyze Repository"
          onAction={() => setShowAddForm(true)}
        />
      ) : (
        <div className="space-y-3">
          {repositories.map((repo) => {
            const snapshot = repo.latestSnapshot;

            return (
              <Card key={repo.id} className="hover:border-[#D1D1CD] transition-colors">
                <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <Link
                        to={`/app/repositories/${repo.id}`}
                        className="text-sm font-bold text-[#202124] hover:text-[#6D5CE8] truncate"
                      >
                        {repo.owner}/{repo.name}
                      </Link>
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

                    <div className="flex items-center gap-4 text-xs text-[#5F6368]">
                      <span>Indexed files: {snapshot?.indexedFiles ?? 0}</span>
                      <span>•</span>
                      <span>Vector chunks: {snapshot?.totalChunks ?? 0}</span>
                      <span>•</span>
                      <a
                        href={repo.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#6D5CE8] hover:underline inline-flex items-center gap-1"
                      >
                        <span>GitHub</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <Link to={`/app/chat?repositoryId=${repo.id}`}>
                      <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5 text-[#6D5CE8]" />
                        <span>Chat</span>
                      </Button>
                    </Link>

                    <Link to={`/app/explorer/${repo.id}`}>
                      <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5">
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>Explorer</span>
                      </Button>
                    </Link>

                    <Link to={`/app/workspaces?repositoryId=${repo.id}`}>
                      <Button variant="secondary" size="sm" className="h-8 text-xs gap-1.5">
                        <Code2 className="w-3.5 h-3.5" />
                        <span>Workspaces</span>
                      </Button>
                    </Link>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default RepositoriesPage;
