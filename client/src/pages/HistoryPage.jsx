import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { listUserRepositories } from "../services/repository.service.js";
import { listWorkspaces, listWorkspaceCheckpoints } from "../services/workspace.service.js";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/Card.jsx";
import Badge from "../components/ui/Badge.jsx";
import { LoadingSpinner } from "../components/shared/Loading.jsx";
import {
  History,
  Clock,
  ShieldCheck,
  ArrowRight,
  Database,
  Layers,
} from "lucide-react";

/**
 * HistoryPage
 * Surfaces real, authentic backend events without fabricating unpersisted history:
 * 1. Pinned workspace states and timestamps
 * 2. Point-in-time workspace checkpoints (snapshots with manifests)
 * 3. Repository indexing snapshot states and chunking activity
 */
export function HistoryPage() {
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

  const activeRepoId = selectedRepoId || (repositories.length > 0 ? repositories[0].id : "");
  const activeRepo = repositories.find((r) => r.id === activeRepoId);

  // 2. Fetch workspaces for active repo
  const {
    data: workspaces = [],
    isLoading: loadingWorkspaces,
  } = useQuery({
    queryKey: ["repo-workspaces", activeRepoId],
    queryFn: () => listWorkspaces(activeRepoId),
    enabled: Boolean(activeRepoId),
  });

  // Selected workspace for checkpoints inspection
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const activeWorkspaceId = selectedWorkspaceId || (workspaces.length > 0 ? workspaces[0].id : "");

  // 3. Fetch checkpoints for active workspace
  const {
    data: checkpoints = [],
    isLoading: loadingCheckpoints,
  } = useQuery({
    queryKey: ["workspace-checkpoints", activeWorkspaceId],
    queryFn: () => listWorkspaceCheckpoints(activeWorkspaceId),
    enabled: Boolean(activeWorkspaceId),
  });

  return (
    <div className="max-w-5xl space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#202124] flex items-center gap-2">
            <History className="w-5 h-5 text-[#6D5CE8]" />
            <span>Activity & Checkpoint History</span>
          </h1>
          <p className="text-xs text-[#5F6368] mt-1">
            Audit trail of repository indexing snapshots, workspace states, and point-in-time restore checkpoints.
          </p>
        </div>

        {repositories.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="repoSelect" className="text-xs text-[#5F6368] font-medium">Repository:</label>
            <select
              id="repoSelect"
              value={activeRepoId}
              onChange={(e) => {
                setSelectedRepoId(e.target.value);
                setSelectedWorkspaceId("");
              }}
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
          Failed to load repository audit history.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Section 1: Repository Indexing History */}
          <div className="space-y-3">
            <h2 className="text-sm font-bold text-[#202124] flex items-center gap-2">
              <Database className="w-4 h-4 text-[#6D5CE8]" />
              <span>Repository Indexing Snapshot</span>
            </h2>

            {activeRepo?.latestSnapshot ? (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs font-mono">
                      Snapshot {activeRepo.latestSnapshot.id.slice(0, 8)}
                    </CardTitle>
                    <Badge
                      variant={
                        activeRepo.latestSnapshot.status === "COMPLETED"
                          ? "success"
                          : activeRepo.latestSnapshot.status === "FAILED"
                          ? "danger"
                          : "warning"
                      }
                      className="text-[10px]"
                    >
                      {activeRepo.latestSnapshot.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="text-xs space-y-2">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-2 border-y border-[#E5E5E2] text-[11px] font-mono">
                    <div>
                      <span className="text-[#80868B] block">Branch:</span>
                      <span className="font-bold text-[#202124]">{activeRepo.latestSnapshot.branch}</span>
                    </div>
                    <div>
                      <span className="text-[#80868B] block">Commit SHA:</span>
                      <span className="font-bold text-[#6D5CE8]">
                        {activeRepo.latestSnapshot.commitSha.slice(0, 7)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#80868B] block">Indexed Files:</span>
                      <span className="font-bold text-[#202124]">
                        {activeRepo.latestSnapshot.indexedFiles} / {activeRepo.latestSnapshot.totalFiles}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#80868B] block">Total Chunks:</span>
                      <span className="font-bold text-[#202124]">{activeRepo.latestSnapshot.totalChunks}</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-[#5F6368] pt-1 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Last updated: {new Date(activeRepo.latestSnapshot.updatedAt).toLocaleString()}</span>
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="p-6 border border-dashed border-[#E5E5E2] rounded-md bg-[#F8F8F6] text-xs text-[#80868B] text-center">
                No indexing snapshot recorded yet for this repository.
              </div>
            )}
          </div>

          {/* Section 2: Workspace Checkpoint Timeline */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <h2 className="text-sm font-bold text-[#202124] flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#25845B]" />
                <span>Workspace Checkpoints</span>
              </h2>

              {workspaces.length > 0 && (
                <div className="flex items-center gap-2">
                  <label htmlFor="wsSelect" className="text-xs text-[#5F6368]">Workspace:</label>
                  <select
                    id="wsSelect"
                    value={activeWorkspaceId}
                    onChange={(e) => setSelectedWorkspaceId(e.target.value)}
                    className="text-xs border border-[#E5E5E2] rounded px-2 py-1 bg-white font-mono focus:outline-none"
                  >
                    {workspaces.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {loadingWorkspaces ? (
              <div className="p-8 border border-[#E5E5E2] rounded-md bg-white">
                <LoadingSpinner label="Loading workspace data..." />
              </div>
            ) : workspaces.length === 0 ? (
              <div className="p-6 border border-dashed border-[#E5E5E2] rounded-md bg-[#F8F8F6] text-xs text-[#80868B] text-center">
                No workspaces created yet for this repository.
              </div>
            ) : loadingCheckpoints ? (
              <div className="p-8 border border-[#E5E5E2] rounded-md bg-white">
                <LoadingSpinner label="Loading checkpoints..." />
              </div>
            ) : checkpoints.length === 0 ? (
              <div className="p-6 border border-dashed border-[#E5E5E2] rounded-md bg-[#F8F8F6] text-xs text-[#80868B] text-center space-y-2">
                <p>No checkpoints saved for this workspace yet.</p>
                <Link to={`/app/workspaces/${activeWorkspaceId}`}>
                  <span className="text-[#6D5CE8] font-medium hover:underline inline-flex items-center gap-1">
                    Open workspace to create checkpoints <ArrowRight className="w-3 h-3" />
                  </span>
                </Link>
              </div>
            ) : (
              <div className="border border-[#E5E5E2] rounded-md divide-y divide-[#E5E5E2] bg-white">
                {checkpoints.map((cp) => (
                  <div key={cp.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[#202124]">{cp.name}</span>
                        <Badge variant="default" className="text-[10px]">
                          {cp.fileCount !== undefined ? `${cp.fileCount} files` : "Snapshot"}
                        </Badge>
                      </div>
                      {cp.description && (
                        <p className="text-[11px] text-[#5F6368]">{cp.description}</p>
                      )}
                      <p className="text-[10px] text-[#80868B] font-mono flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>{new Date(cp.createdAt).toLocaleString()}</span>
                      </p>
                    </div>

                    <Link to={`/app/workspaces/${activeWorkspaceId}`}>
                      <span className="text-xs text-[#6D5CE8] font-medium hover:underline inline-flex items-center gap-1">
                        Inspect in Editor <ArrowRight className="w-3 h-3" />
                      </span>
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Data Integrity Safeguard */}
          <div className="p-3.5 rounded-md border border-[#E5E5E2] bg-[#F8F8F6] text-xs text-[#5F6368] flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#25845B] shrink-0" />
            <span>
              All history records are strictly bound to authenticated database rows and pinned commit SHAs.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default HistoryPage;
