import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { listUserRepositories } from "../services/repository.service.js";
import { listWorkspaces } from "../services/workspace.service.js";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";
import Badge from "../components/ui/Badge.jsx";
import { LoadingSpinner } from "../components/shared/Loading.jsx";
import {
  GitPullRequest,
  ExternalLink,
  Code2,
  FolderGit2,
  Info,
  ArrowRight,
} from "lucide-react";

/**
 * PullRequestsPage
 * In accordance with strict RepoMind principles:
 * - We do NOT invent artificial or simulated PR data.
 * - The backend implements direct PR creation via POST /api/workspaces/:id/pull-request,
 *   returning confirmed GitHub PR numbers and URLs.
 * - This page surfaces the publishing workflow, informs the user of active repositories
 *   and workspaces from which changes can be reviewed and published, and explains
 *   GitHub PR tracking truthfully without inventing unsupported database records.
 */
export function PullRequestsPage() {
  const [selectedRepoId, setSelectedRepoId] = useState("");

  // 1. Fetch user repositories
  const {
    data: repositories = [],
    isLoading: loadingRepos,
    error: reposError,
  } = useQuery({
    queryKey: ["user-repositories"],
    queryFn: listUserRepositories,
  });

  // Effective repository selection
  const activeRepoId = selectedRepoId || (repositories.length > 0 ? repositories[0].id : "");
  const activeRepo = repositories.find((r) => r.id === activeRepoId);

  // 2. Fetch workspaces for active repository
  const {
    data: workspaces = [],
    isLoading: loadingWorkspaces,
  } = useQuery({
    queryKey: ["repo-workspaces", activeRepoId],
    queryFn: () => listWorkspaces(activeRepoId),
    enabled: Boolean(activeRepoId),
  });

  return (
    <div className="max-w-5xl space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#202124] flex items-center gap-2">
            <GitPullRequest className="w-5 h-5 text-[#6D5CE8]" />
            <span>GitHub Pull Requests</span>
          </h1>
          <p className="text-xs text-[#5F6368] mt-1">
            Review workspace modifications, publish to remote feature branches, and submit Pull Requests to GitHub.
          </p>
        </div>

        {repositories.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="repoSelect" className="text-xs text-[#5F6368] font-medium">Repository:</label>
            <select
              id="repoSelect"
              value={activeRepoId}
              onChange={(e) => setSelectedRepoId(e.target.value)}
              className="text-xs border border-[#E5E5E2] rounded px-2.5 py-1.5 bg-white font-mono focus:outline-none focus:ring-1 focus:ring-[#6D5CE8]"
            >
              {repositories.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.owner}/{repo.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {loadingRepos ? (
        <div className="p-12 border border-[#E5E5E2] rounded-md bg-white">
          <LoadingSpinner label="Loading repositories..." />
        </div>
      ) : reposError ? (
        <div className="p-6 border border-[#C84C4C]/20 rounded-md bg-[#C84C4C]/5 text-xs text-[#C84C4C]">
          Failed to load repositories. Please ensure your session is active.
        </div>
      ) : repositories.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No Repositories Configured</CardTitle>
            <CardDescription>
              Analyze and index a GitHub repository first to create workspaces and publish changes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/app/repositories">
              <Button size="sm">Go to Repositories</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Active Repository Card */}
          {activeRepo && (
            <div className="p-4 bg-white border border-[#E5E5E2] rounded-md flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded bg-[#6D5CE8]/10 text-[#6D5CE8] flex items-center justify-center shrink-0">
                  <FolderGit2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-[#202124]">{activeRepo.owner}/{activeRepo.name}</h3>
                  <p className="text-[11px] text-[#5F6368]">
                    Default Branch: <span className="font-mono font-medium">{activeRepo.defaultBranch}</span> • Role: <Badge variant="default" className="text-[10px] ml-1">{activeRepo.role}</Badge>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={activeRepo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[#5F6368] hover:text-[#202124] border border-[#E5E5E2] px-2.5 py-1.5 rounded bg-[#F8F8F6]"
                >
                  <span>View on GitHub</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                <a
                  href={`${activeRepo.url}/pulls`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[#6D5CE8] font-medium border border-[#6D5CE8]/20 px-2.5 py-1.5 rounded bg-[#6D5CE8]/5 hover:bg-[#6D5CE8]/10"
                >
                  <span>Open GitHub Pull Requests</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          )}

          {/* Publishing Workspaces Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-[#202124]">Workspaces Available for Publishing</h2>
                <p className="text-[11px] text-[#5F6368]">
                  Open any workspace to inspect unified diffs against the pinned baseline and publish to GitHub.
                </p>
              </div>
            </div>

            {loadingWorkspaces ? (
              <div className="p-8 border border-[#E5E5E2] rounded-md bg-white">
                <LoadingSpinner label="Loading workspaces..." />
              </div>
            ) : workspaces.length === 0 ? (
              <div className="p-8 border border-dashed border-[#E5E5E2] rounded-md bg-[#F8F8F6] text-center text-xs text-[#80868B] space-y-3">
                <Code2 className="w-6 h-6 mx-auto text-[#80868B]" />
                <p>No active workspaces found for this repository.</p>
                <Link to={`/app/workspaces?repositoryId=${activeRepoId}`}>
                  <Button size="sm" variant="secondary">Create Workspace</Button>
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {workspaces.map((ws) => (
                  <Card key={ws.id} className="hover:border-[#6D5CE8]/40 transition-colors">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-mono">{ws.name}</CardTitle>
                        <Badge variant="default" className="text-[10px]">
                          {ws.baseCommitSha ? `Base: ${ws.baseCommitSha.slice(0, 7)}` : "Unpinned"}
                        </Badge>
                      </div>
                      <CardDescription className="text-[11px]">
                        Last modified: {new Date(ws.updatedAt).toLocaleString()}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <Link to={`/app/workspaces/${ws.id}`}>
                        <Button size="sm" className="w-full justify-between gap-1 text-xs">
                          <span>Open Workspace & Publish</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      </Link>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Architecture & Backend Guarantees Notice */}
          <div className="p-4 rounded-md border border-[#E5E5E2] bg-[#F8F8F6] text-xs text-[#5F6368] space-y-2">
            <div className="flex items-center gap-1.5 font-bold text-[#202124]">
              <Info className="w-4 h-4 text-[#6D5CE8]" />
              <span>How Pull Requests Work in RepoMind</span>
            </div>
            <p>
              RepoMind maintains a strict <strong>read-only AI invariant</strong>. AI assistance never writes code directly or opens pull requests.
            </p>
            <p>
              All published code represents your explicit, manually saved workspace edits. Publishing verifies the remote baseline commit SHA hasn&apos;t diverged, generates Myers unified diffs, writes Git blobs, commits against the pinned baseline tree, and submits a Pull Request to your default branch via GitHub&apos;s REST API.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default PullRequestsPage;
