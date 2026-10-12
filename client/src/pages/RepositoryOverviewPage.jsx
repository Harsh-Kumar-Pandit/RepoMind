import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  getRepositoryIndexStatus,
  triggerRepositoryIndexing,
  listUserRepositories,
} from "../services/repository.service.js";
import { listWorkspaces, createWorkspace } from "../services/workspace.service.js";
import Button from "../components/ui/Button.jsx";
import Input from "../components/ui/Input.jsx";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/Card.jsx";
import Badge from "../components/ui/Badge.jsx";
import Notification from "../components/ui/Notification.jsx";
import { LoadingSpinner } from "../components/shared/Loading.jsx";
import ErrorState from "../components/shared/ErrorState.jsx";
import { formatActionableErrorMessage, cn } from "../lib/utils.js";
import {
  BookOpen,
  MessageSquare,
  Code2,
  ExternalLink,
  Play,
  Plus,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";

export function RepositoryOverviewPage() {
  const { repositoryId } = useParams();
  const [indexing, setIndexing] = useState(false);
  const [indexError, setIndexError] = useState("");
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");

  // Fetch repository record
  const {
    data: repositories = [],
    isLoading: loadingRepo,
    refetch: refetchRepo,
  } = useQuery({
    queryKey: ["user-repositories"],
    queryFn: listUserRepositories,
  });

  const repository = repositories.find((r) => r.id === repositoryId);

  // Poll indexing status if indexing is pending or running
  const {
    data: indexStatus,
    isLoading: loadingIndexStatus,
    refetch: refetchIndexStatus,
  } = useQuery({
    queryKey: ["repo-index-status", repositoryId],
    queryFn: () => getRepositoryIndexStatus(repositoryId),
    enabled: Boolean(repositoryId),
    refetchInterval: (query) => {
      const status = query.state?.data?.status;
      return status === "INDEXING" || status === "PENDING" ? 3000 : false;
    },
  });

  // Fetch workspaces for this repository
  const {
    data: workspaces = [],
    refetch: refetchWorkspaces,
  } = useQuery({
    queryKey: ["repo-workspaces", repositoryId],
    queryFn: () => listWorkspaces(repositoryId),
    enabled: Boolean(repositoryId),
  });

  async function handleTriggerIndex() {
    setIndexing(true);
    setIndexError("");
    try {
      await triggerRepositoryIndexing(repositoryId);
      await refetchIndexStatus();
    } catch (err) {
      setIndexError(
        formatActionableErrorMessage(
          err,
          "Failed to trigger indexing. Check API quota."
        )
      );
    } finally {
      setIndexing(false);
    }
  }

  async function handleCreateWorkspace(e) {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;

    setCreatingWorkspace(true);
    setWorkspaceError("");
    try {
      await createWorkspace({
        repositoryId,
        name: newWorkspaceName.trim(),
      });
      setNewWorkspaceName("");
      await refetchWorkspaces();
    } catch (err) {
      setWorkspaceError(err.customMessage || "Failed to create workspace.");
    } finally {
      setCreatingWorkspace(false);
    }
  }

  if (loadingRepo || loadingIndexStatus) {
    return (
      <div className="p-12 border border-[#E5E5E2] rounded-md bg-white">
        <LoadingSpinner label="Loading repository details..." />
      </div>
    );
  }

  if (!repository) {
    return (
      <ErrorState
        title="Repository not found"
        message="The repository could not be found or you do not have permission to view it."
        onRetry={refetchRepo}
      />
    );
  }

  const totalFiles = indexStatus?.totalFiles ?? 0;
  const indexedFiles = indexStatus?.indexedFiles ?? 0;
  const totalChunks = indexStatus?.totalChunks ?? 0;
  const status = indexStatus?.status || "NOT_STARTED";
  const isIndexing = status === "INDEXING" || status === "PENDING";
  const isIndexed = status === "COMPLETED";
  const isPartial = status === "PARTIAL";
  const isFailed = status === "FAILED";

  // Calculate file-based progress percentage safely
  let progressPercent = 0;
  if (isIndexed) {
    progressPercent = 100;
  } else if (totalFiles > 0) {
    const rawProgress = Math.floor((indexedFiles / totalFiles) * 100);
    // Never display 100% until indexing is genuinely completed
    progressPercent = isIndexing ? Math.min(rawProgress, 99) : rawProgress;
  }

  const statusBadgeVariant = isIndexed
    ? "success"
    : isIndexing || isPartial
    ? "warning"
    : isFailed
    ? "danger"
    : "default";

  const statusDisplayLabel =
    status === "PENDING"
      ? "QUEUED"
      : status;

  return (
    <div className="max-w-4xl space-y-6">
      {/* Overview Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E5E5E2] pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#202124]">
              {repository.owner}/{repository.name}
            </h1>
            <Badge variant="default" className="text-xs">
              {repository.defaultBranch}
            </Badge>
            <Badge variant={repository.role === "OWNER" ? "violet" : "default"} className="text-xs">
              {repository.role}
            </Badge>
          </div>

          <div className="flex items-center gap-3 text-xs text-[#5F6368]">
            <a
              href={repository.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#6D5CE8] hover:underline inline-flex items-center gap-1"
            >
              <span>View on GitHub</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <span>•</span>
            <span>Analyzed {new Date(repository.createdAt).toLocaleDateString()}</span>
          </div>
        </div>

        {/* Primary Action Buttons */}
        <div className="flex items-center gap-2">
          <Link to={`/app/explorer/${repository.id}`}>
            <Button variant="secondary" size="sm" className="gap-1.5 text-xs">
              <BookOpen className="w-3.5 h-3.5" />
              <span>Explore Files</span>
            </Button>
          </Link>

          <Link to={`/app/chat?repositoryId=${repository.id}`}>
            <Button variant="default" size="sm" className="gap-1.5 text-xs">
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Ask RepoMind</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Indexing Status Card */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm">RAG Code Indexing</CardTitle>
              <Badge variant={statusBadgeVariant} className="flex items-center gap-1">
                {isIndexing && <Loader2 className="w-3 h-3 animate-spin" />}
                <span>{statusDisplayLabel}</span>
              </Badge>
            </div>

            {!isIndexed && !isIndexing && (
              <Button
                size="sm"
                variant="secondary"
                onClick={handleTriggerIndex}
                loading={indexing}
                className="gap-1.5 text-xs h-7"
              >
                {isFailed || isPartial ? (
                  <>
                    <RotateCcw className="w-3 h-3" />
                    <span>Retry Indexing</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3" />
                    <span>Start Indexing</span>
                  </>
                )}
              </Button>
            )}
          </div>

          <CardDescription>
            {isIndexed
              ? `Repository is fully indexed with code embeddings (${indexStatus?.dimensions || 768}-d). Ready for grounded AI explanations.`
              : isIndexing
              ? "Background indexing worker is parsing code files, chunking tokens, and caching vector embeddings..."
              : isFailed
              ? "Indexing encountered an issue and stopped. Check the error details below and retry when ready."
              : isPartial
              ? "Indexing paused with partial progress. Some files could not be indexed due to quota or duration limits."
              : "Generate code embeddings so AI can answer grounded queries with exact file and line citations."}
          </CardDescription>
        </CardHeader>

        <CardContent className="p-4 pt-2 space-y-4">
          {/* Visual Progress Bar Section */}
          {(isIndexing || isIndexed || isPartial || totalFiles > 0) && (
            <div className="space-y-2 pt-2 border-t border-[#E5E5E2]/50">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[#202124] text-sm font-mono">
                    {progressPercent}% complete
                  </span>
                  <span className="text-[#5F6368] hidden sm:inline">
                    {isIndexed
                      ? "• Ready for chat"
                      : isIndexing
                      ? "• indexing in progress"
                      : isPartial
                      ? "• partial progress preserved"
                      : isFailed
                      ? "• halted"
                      : ""}
                  </span>
                </div>
                <div className="text-[#5F6368] font-mono text-xs">
                  {totalFiles > 0 ? (
                    <span>
                      <strong className="text-[#202124]">{indexedFiles}</strong> of{" "}
                      <strong>{totalFiles}</strong> files
                    </span>
                  ) : (
                    <span>{indexedFiles} files indexed</span>
                  )}
                </div>
              </div>

              {/* Progress Track */}
              <div
                className="w-full bg-[#E5E5E2] rounded-full h-2.5 overflow-hidden"
                role="progressbar"
                aria-valuenow={progressPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Repository code indexing progress"
              >
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500 ease-out",
                    isIndexed
                      ? "bg-[#25845B]"
                      : isFailed
                      ? "bg-[#C84C4C]"
                      : isPartial
                      ? "bg-[#D97706]"
                      : "bg-[#6D5CE8]"
                  )}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* Metrics Grid */}
          {indexStatus && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-[#E5E5E2]/50 text-xs">
              <div>
                <p className="text-[10px] text-[#80868B] uppercase font-bold">Indexed Files</p>
                <p className="text-sm font-semibold text-[#202124]">
                  {totalFiles > 0 ? `${indexedFiles} of ${totalFiles}` : indexedFiles}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-[#80868B] uppercase font-bold">Vector Chunks</p>
                <p className="text-sm font-semibold text-[#202124]">{totalChunks}</p>
              </div>
              <div>
                <p className="text-[10px] text-[#80868B] uppercase font-bold">Ready for Chat</p>
                <p className="text-sm font-semibold">
                  {isIndexed ? (
                    <span className="text-[#25845B]">Ready</span>
                  ) : isPartial ? (
                    <span className="text-[#D97706]">Partial ({indexedFiles}/{totalFiles || indexedFiles} files)</span>
                  ) : isIndexing ? (
                    <span className="text-[#5F6368]">Pending (indexing)</span>
                  ) : (
                    <span className="text-[#80868B]">No</span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-[#80868B] uppercase font-bold">Commit SHA</p>
                <p className="text-xs font-mono text-[#5F6368] truncate">
                  {indexStatus.commitSha?.slice(0, 7) || "default"}
                </p>
              </div>
            </div>
          )}

          {/* User Guidance & Clear Next-Step Hints */}
          {isIndexing && (
            <div className="p-3.5 bg-[#F9F9F8] border border-[#E5E5E2] rounded text-xs space-y-2">
              <p className="text-[#202124] leading-relaxed">
                RepoMind is learning the structure of this repository. You can follow the progress here. Once indexing is complete, you can ask questions about the code, get answers with file citations, explore source files, and create a workspace to edit code manually.
              </p>
              <div className="flex items-start sm:items-center gap-1.5 text-[#5F6368] pt-2 border-t border-[#E5E5E2]/70">
                <span className="font-semibold text-[#202124] shrink-0">Next step:</span>
                <span>You can explore files while indexing continues. AI answers grounded in the full repository will be available when indexing completes.</span>
              </div>
            </div>
          )}

          {isIndexed && (
            <div className="p-3.5 bg-[#25845B]/5 border border-[#25845B]/20 rounded text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-[#25845B] font-semibold">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>100% complete — Ready for chat</span>
                </div>
                <p className="text-[#202124] text-xs">
                  Ready to go! Ask RepoMind a question, explore files, or create a workspace to edit code.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link to={`/app/chat?repositoryId=${repository.id}`}>
                  <Button size="sm" variant="default" className="text-xs h-7 gap-1">
                    <MessageSquare className="w-3 h-3" />
                    <span>Ask RepoMind</span>
                  </Button>
                </Link>
              </div>
            </div>
          )}

          {isFailed && (
            <div className="p-3.5 bg-[#C84C4C]/5 border border-[#C84C4C]/20 rounded text-xs space-y-1.5">
              <div className="flex items-center gap-2 text-[#C84C4C] font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Indexing failed</span>
              </div>
              <p className="text-[#5F6368]">
                <strong className="text-[#202124]">Next step:</strong> Indexing could not finish. Check the error and retry after fixing the issue.
              </p>
            </div>
          )}

          {isPartial && (
            <div className="p-3.5 bg-[#D97706]/5 border border-[#D97706]/20 rounded text-xs space-y-2">
              <div className="flex items-center gap-2 text-[#D97706] font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Ready for chat: Partial ({indexedFiles} of {totalFiles || indexedFiles} files)</span>
              </div>
              <p className="text-[#202124] leading-relaxed">
                Indexing paused with partial progress. Chunks generated so far are available for grounded queries, but repository coverage is incomplete.
              </p>
              <div className="pt-1 text-[#5F6368] space-y-1">
                {/quota/i.test(indexStatus?.errorMessage || "") ? (
                  <p>
                    <strong className="text-[#202124]">Blocking reason:</strong> Gemini embedding quota exhausted. OpenRouter fallback is configured and will be used when you click Retry Indexing.
                  </p>
                ) : /rate limit/i.test(indexStatus?.errorMessage || "") ? (
                  <p>
                    <strong className="text-[#202124]">Blocking reason:</strong> GitHub API rate limit reached. {formatActionableErrorMessage({ message: indexStatus.errorMessage })}
                  </p>
                ) : (
                  <p>
                    <strong className="text-[#202124]">Blocking reason:</strong> {indexStatus?.errorMessage || "Partial progress preserved."}
                  </p>
                )}
                <p>
                  <strong className="text-[#202124]">Next step:</strong> Click <strong>Retry Indexing</strong> to resume indexing missing files without losing completed work.
                </p>
              </div>
            </div>
          )}

          {indexStatus?.errorMessage && (
            <Notification
              type={indexStatus.status === "PARTIAL" ? "warning" : "error"}
              title={`Indexing ${indexStatus.status}`}
              message={formatActionableErrorMessage({ message: indexStatus.errorMessage })}
              className="mt-3"
            />
          )}

          {indexError && (
            <Notification
              type="error"
              title="Indexing Error"
              message={indexError}
              className="mt-3"
            />
          )}
        </CardContent>
      </Card>

      {/* Workspaces Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-[#202124]">Workspaces</h2>
            <p className="text-xs text-[#5F6368]">
              Editable workspaces connected to this repository with point-in-time checkpoints.
            </p>
          </div>
        </div>

        {/* Create Workspace Mini-Form */}
        <form onSubmit={handleCreateWorkspace} className="flex gap-2">
          <Input
            placeholder="Workspace name (e.g. feature-refactor)"
            value={newWorkspaceName}
            onChange={(e) => setNewWorkspaceName(e.target.value)}
            className="text-xs font-mono h-8"
          />
          <Button type="submit" size="sm" loading={creatingWorkspace} className="h-8 shrink-0 text-xs gap-1">
            <Plus className="w-3.5 h-3.5" />
            <span>New Workspace</span>
          </Button>
        </form>
        {workspaceError && <p className="text-xs text-[#C84C4C]">{workspaceError}</p>}

        {/* Workspace List */}
        {workspaces.length === 0 ? (
          <div className="p-6 border border-dashed border-[#E5E5E2] rounded bg-white text-center text-xs text-[#5F6368]">
            No workspaces created for this repository yet. Create one above to start manually editing code.
          </div>
        ) : (
          <div className="space-y-2">
            {workspaces.map((ws) => (
              <div
                key={ws.id}
                className="p-3 border border-[#E5E5E2] rounded bg-white flex items-center justify-between hover:border-[#D1D1CD] transition-colors"
              >
                <div>
                  <h4 className="text-xs font-bold text-[#202124]">{ws.name}</h4>
                  <p className="text-[10px] text-[#80868B] font-mono mt-0.5">
                    Pinned baseline: {ws.baseCommitSha ? ws.baseCommitSha.slice(0, 7) : "unpinned"}
                  </p>
                </div>

                <Link to={`/app/workspaces/${ws.id}`}>
                  <Button variant="secondary" size="sm" className="h-7 text-xs gap-1">
                    <Code2 className="w-3 h-3" />
                    <span>Open Editor</span>
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default RepositoryOverviewPage;
