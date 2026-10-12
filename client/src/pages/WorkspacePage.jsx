import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getWorkspace,
  listWorkspaces,
  createWorkspace,
  initWorkspaceFiles,
  deleteWorkspace,
  listWorkspaceFiles,
  getWorkspaceFile,
  saveWorkspaceFile,
  deleteWorkspaceFile,
  getWorkspaceDiff,
  createWorkspaceCheckpoint,
  listWorkspaceCheckpoints,
  restoreWorkspaceCheckpoint,
} from "../services/workspace.service.js";
import { listUserRepositories } from "../services/repository.service.js";
import {
  publishWorkspaceChanges,
  createPullRequest,
} from "../services/publish.service.js";
import WorkspaceFileTree from "../components/workspace/WorkspaceFileTree.jsx";
import EditorTabs from "../components/workspace/EditorTabs.jsx";
import WorkspaceEditor from "../components/workspace/WorkspaceEditor.jsx";
import DiffViewer from "../components/workspace/DiffViewer.jsx";
import CheckpointPanel from "../components/workspace/CheckpointPanel.jsx";
import ConflictDialog from "../components/workspace/ConflictDialog.jsx";
import PublishingModal from "../components/workspace/PublishingModal.jsx";
import Button from "../components/ui/Button.jsx";
import Badge from "../components/ui/Badge.jsx";
import Input from "../components/ui/Input.jsx";
import Card, { CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/Card.jsx";
import { LoadingSpinner } from "../components/shared/Loading.jsx";
import ErrorState from "../components/shared/ErrorState.jsx";
import EmptyState from "../components/shared/EmptyState.jsx";
import {
  Save,
  GitCompare,
  History,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  FileCode,
  Upload,
  Code2,
  FolderGit2,
  Plus,
  Trash2,
  Calendar,
} from "lucide-react";

/**
 * WorkspaceListView:
 * Rendered when no specific workspaceId is selected (e.g. /app/workspaces or /app/workspaces?repositoryId=...)
 * Lists workspaces for a repository or across all user repositories, and provides workspace creation.
 */
function WorkspaceListView() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const repositoryId = searchParams.get("repositoryId");
  const initialFilePath = searchParams.get("filePath");

  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [initializeFiles, setInitializeFiles] = useState(true);
  const [userSelectedRepoId, setUserSelectedRepoId] = useState("");
  const [createError, setCreateError] = useState("");
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState(null);

  // 1. Fetch user repositories if repo selection is needed
  const { data: userRepos = [] } = useQuery({
    queryKey: ["user-repos"],
    queryFn: listUserRepositories,
  });

  const selectedRepoId = repositoryId || userSelectedRepoId || userRepos[0]?.id || "";
  const currentRepo = userRepos.find((r) => r.id === (repositoryId || selectedRepoId));

  // 2. Fetch workspaces list (either for repositoryId or all user workspaces)
  const {
    data: workspaces = [],
    isLoading: loadingWorkspaces,
    error: workspacesError,
    refetch: refetchWorkspaces,
  } = useQuery({
    queryKey: ["workspaces-list", repositoryId || "all"],
    queryFn: () => listWorkspaces(repositoryId || null),
  });

  // 3. Create workspace mutation
  const createMutation = useMutation({
    mutationFn: ({ repoId, name, initializeFiles }) =>
      createWorkspace({
        repositoryId: repoId,
        name,
        initializeFiles,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries(["workspaces-list"]);
      setNewWorkspaceName("");
      const targetUrl = initialFilePath
        ? `/app/workspaces/${data.id}?filePath=${encodeURIComponent(initialFilePath)}`
        : `/app/workspaces/${data.id}`;
      navigate(targetUrl);
    },
    onError: (err) => {
      setCreateError(
        err.response?.data?.error?.message || err.customMessage || "Failed to create workspace."
      );
    },
  });

  // 4. Delete workspace mutation
  const deleteMutation = useMutation({
    mutationFn: (id) => deleteWorkspace(id),
    onSuccess: () => {
      queryClient.invalidateQueries(["workspaces-list"]);
      setDeletingWorkspaceId(null);
    },
    onError: (err) => {
      alert(err.response?.data?.error?.message || "Failed to delete workspace.");
      setDeletingWorkspaceId(null);
    },
  });

  function handleCreate(e) {
    e.preventDefault();
    const targetRepo = repositoryId || selectedRepoId;
    if (!targetRepo) {
      setCreateError("Please select a repository to create a workspace.");
      return;
    }
    if (!newWorkspaceName.trim()) {
      setCreateError("Workspace name is required.");
      return;
    }

    setCreateError("");
    createMutation.mutate({
      repoId: targetRepo,
      name: newWorkspaceName.trim(),
      initializeFiles,
    });
  }

  const activeRepoObj = userRepos.find((r) => r.id === (repositoryId || selectedRepoId));
  const repoDisplayName = currentRepo
    ? `${currentRepo.owner}/${currentRepo.name}`
    : activeRepoObj
    ? `${activeRepoObj.owner}/${activeRepoObj.name}`
    : null;

  return (
    <div className="space-y-6 max-w-5xl mx-auto py-2">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E5E5E2] pb-4">
        <div>
          <div className="flex items-center gap-2">
            {repositoryId && (
              <Link
                to={`/app/repositories/${repositoryId}`}
                className="text-[#5F6368] hover:text-[#202124] p-1 rounded"
              >
                <ArrowLeft className="w-4 h-4" />
              </Link>
            )}
            <h1 className="text-xl font-bold text-[#202124] tracking-tight flex items-center gap-2">
              <Code2 className="w-5 h-5 text-[#6D5CE8]" />
              <span>Workspaces</span>
            </h1>
          </div>
          <p className="text-xs text-[#5F6368] mt-1">
            {repoDisplayName
              ? `Active workspaces for ${repoDisplayName}. Isolated sandboxes for editing files, tracking diffs, and submitting PRs.`
              : "Isolated developer environments for manual file modifications, diff review, and pull requests."}
          </p>
        </div>

        {repositoryId && (
          <Link to={`/app/repositories/${repositoryId}`}>
            <Button variant="outline" size="sm" className="text-xs gap-1.5">
              <FolderGit2 className="w-3.5 h-3.5" />
              <span>Repository Overview</span>
            </Button>
          </Link>
        )}
      </div>

      {/* Target file pill if navigating from explorer */}
      {initialFilePath && (
        <div className="p-3 bg-[#6D5CE8]/5 border border-[#6D5CE8]/20 rounded-md flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-[#202124]">
            <FileCode className="w-4 h-4 text-[#6D5CE8]" />
            <span>Target file for editing: <strong className="font-mono">{initialFilePath}</strong></span>
          </div>
          <span className="text-[11px] text-[#5F6368]">Opening a workspace will load this file</span>
        </div>
      )}

      {/* Create Workspace Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Plus className="w-4 h-4 text-[#6D5CE8]" />
            <span>Create New Workspace</span>
          </CardTitle>
          <CardDescription className="text-xs">
            Start a new isolated workspace to manually edit code and propose changes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              {!repositoryId && (
                <div className="sm:w-64">
                  <select
                    value={selectedRepoId}
                    onChange={(e) => setUserSelectedRepoId(e.target.value)}
                    className="h-9 w-full rounded border border-[#E5E5E2] bg-white px-3 text-xs text-[#202124] outline-none focus:border-[#6D5CE8]"
                  >
                    <option value="" disabled>Select Repository</option>
                    {userRepos.map((repo) => (
                      <option key={repo.id} value={repo.id}>
                        {repo.owner}/{repo.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex-1">
                <Input
                  type="text"
                  placeholder="Workspace name (e.g. fix-auth-flow, add-logging)"
                  value={newWorkspaceName}
                  onChange={(e) => setNewWorkspaceName(e.target.value)}
                  disabled={createMutation.isPending}
                  className="h-9 text-xs"
                />
              </div>

              <Button
                type="submit"
                disabled={createMutation.isPending || !newWorkspaceName.trim()}
                className="h-9 text-xs gap-1.5 shrink-0"
              >
                {createMutation.isPending ? (
                  <>
                    <span className="animate-spin">⟳</span>
                    <span>Creating...</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create Workspace</span>
                  </>
                )}
              </Button>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <label className="flex items-center gap-2 text-xs text-[#5F6368] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={initializeFiles}
                  onChange={(e) => setInitializeFiles(e.target.checked)}
                  className="rounded border-[#E5E5E2] text-[#6D5CE8] focus:ring-[#6D5CE8]"
                />
                <span>Initialize workspace with baseline repository files</span>
              </label>
            </div>

            {createError && (
              <p className="text-xs text-[#C84C4C] flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{createError}</span>
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Workspaces List Section */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-[#202124] flex items-center justify-between">
          <span>Existing Workspaces ({workspaces.length})</span>
          <Button variant="ghost" size="sm" onClick={() => refetchWorkspaces()} className="h-6 text-[11px] text-[#5F6368]">
            Refresh
          </Button>
        </h2>

        {loadingWorkspaces ? (
          <div className="p-12 border border-[#E5E5E2] rounded-md bg-white">
            <LoadingSpinner label="Loading workspaces..." />
          </div>
        ) : workspacesError ? (
          <ErrorState
            title="Failed to load workspaces"
            message={workspacesError.response?.data?.error?.message || workspacesError.message}
            onRetry={refetchWorkspaces}
          />
        ) : workspaces.length === 0 ? (
          <EmptyState
            icon={Code2}
            title={repositoryId ? "No workspaces for this repository yet" : "No workspaces created yet"}
            description={
              repositoryId
                ? "Create your first workspace above to start safely editing files and creating pull requests."
                : "Select a repository to create an isolated workspace for file editing and pull requests."
            }
            actionText={repositoryId ? null : "Browse Repositories"}
            onAction={repositoryId ? null : () => navigate("/app/repositories")}
          />
        ) : (
          <div className="grid gap-3">
            {workspaces.map((ws) => {
              const wsLink = initialFilePath
                ? `/app/workspaces/${ws.id}?filePath=${encodeURIComponent(initialFilePath)}`
                : `/app/workspaces/${ws.id}`;

              return (
                <Card key={ws.id} className="hover:border-[#D1D1CD] transition-colors">
                  <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          to={wsLink}
                          className="text-sm font-bold text-[#202124] hover:text-[#6D5CE8] font-mono truncate"
                        >
                          {ws.name}
                        </Link>
                        {ws.repository && (
                          <Badge variant="default" className="text-[10px] py-0">
                            {ws.repository.owner}/{ws.repository.name}
                          </Badge>
                        )}
                        <Badge variant="default" className="text-[10px] font-mono py-0">
                          Base: {ws.baseCommitSha ? ws.baseCommitSha.slice(0, 7) : "unpinned"}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-3 text-xs text-[#5F6368]">
                        <span>{ws.fileCount || 0} modified file{ws.fileCount === 1 ? "" : "s"}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-[#80868B]" />
                          <span>Last active {new Date(ws.updatedAt).toLocaleDateString()}</span>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeletingWorkspaceId(ws.id)}
                        disabled={deleteMutation.isPending}
                        className="h-8 text-xs text-[#80868B] hover:text-[#C84C4C] p-2"
                        title="Delete workspace"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>

                      <Link to={wsLink}>
                        <Button size="sm" variant="secondary" className="h-8 text-xs gap-1.5">
                          <Code2 className="w-3.5 h-3.5" />
                          <span>Open Editor</span>
                          <ArrowRight className="w-3 h-3" />
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

      {/* Delete Workspace Confirmation Modal */}
      {deletingWorkspaceId && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E5E2] rounded-md shadow-lg max-w-sm w-full p-4 space-y-3 text-xs">
            <h3 className="font-bold text-sm text-[#202124]">Delete Workspace?</h3>
            <p className="text-[#5F6368]">
              Are you sure you want to delete this workspace? All uncommitted edits and checkpoints will be permanently deleted.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setDeletingWorkspaceId(null)}
                disabled={deleteMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => deleteMutation.mutate(deletingWorkspaceId)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete Workspace"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * WorkspaceEditorView:
 * Rendered when a valid workspaceId is provided (e.g. /app/workspaces/:workspaceId).
 * Hosts the complete multi-tab editor, OCC file persistence, diff comparisons, checkpoints, and PR publishing.
 */
function WorkspaceEditorView({ workspaceId }) {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const initialFilePath = searchParams.get("filePath");

  // Tab & Editor State
  const [openTabs, setOpenTabs] = useState(() => (initialFilePath ? [initialFilePath] : []));
  const [activePath, setActivePath] = useState(() => initialFilePath || null);
  const [editorContents, setEditorContents] = useState({}); // path -> string content
  const [serverHashes, setServerHashes] = useState({});     // path -> hash string
  const [unsavedPaths, setUnsavedPaths] = useState(new Set());
  const [activeBottomPanel, setActiveBottomPanel] = useState(null); // 'diff' | 'checkpoints' | null
  const [saveStatus, setSaveStatus] = useState("idle"); // 'idle' | 'saving' | 'saved' | 'error'
  const [saveError, setSaveError] = useState("");
  const [conflictData, setConflictData] = useState(null);
  const [confirmDeletePath, setConfirmDeletePath] = useState(null);
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);

  // 1. Fetch workspace details
  const {
    data: workspace,
    isLoading: loadingWorkspace,
    error: workspaceError,
    refetch: refetchWorkspace,
  } = useQuery({
    queryKey: ["workspace", workspaceId],
    queryFn: () => getWorkspace(workspaceId),
    enabled: Boolean(workspaceId),
  });

  // 2. Fetch workspace file listing
  const {
    data: files = [],
    refetch: refetchFiles,
  } = useQuery({
    queryKey: ["workspace-files", workspaceId],
    queryFn: () => listWorkspaceFiles(workspaceId),
    enabled: Boolean(workspaceId),
  });

  // 3. Fetch workspace diff data
  const {
    data: diffData,
    isLoading: loadingDiff,
    refetch: refetchDiff,
  } = useQuery({
    queryKey: ["workspace-diff", workspaceId],
    queryFn: () => getWorkspaceDiff(workspaceId),
    enabled: Boolean(workspaceId),
  });

  // 4. Fetch checkpoints
  const {
    data: checkpoints = [],
    refetch: refetchCheckpoints,
  } = useQuery({
    queryKey: ["workspace-checkpoints", workspaceId],
    queryFn: () => listWorkspaceCheckpoints(workspaceId),
    enabled: Boolean(workspaceId && activeBottomPanel === "checkpoints"),
  });

  // 5. Automatically fetch content when activePath is selected and not in memory
  useEffect(() => {
    let isCancelled = false;
    if (activePath && workspaceId && editorContents[activePath] === undefined) {
      getWorkspaceFile(workspaceId, activePath)
        .then((fileRecord) => {
          if (!isCancelled) {
            setEditorContents((prev) => ({ ...prev, [activePath]: fileRecord.content }));
            setServerHashes((prev) => ({ ...prev, [activePath]: fileRecord.contentHash }));
            refetchFiles();
          }
        })
        .catch((err) => {
          console.error("Failed to load file content:", err);
        });
    }
    return () => {
      isCancelled = true;
    };
  }, [activePath, workspaceId, editorContents, refetchFiles]);

  // Mutation to initialize baseline files
  const initFilesMutation = useMutation({
    mutationFn: () => initWorkspaceFiles(workspaceId),
    onSuccess: () => {
      refetchFiles();
      refetchDiff();
    },
    onError: (err) => {
      alert(err.response?.data?.error?.message || err.customMessage || "Failed to initialize files.");
    },
  });

  // Open / Select File
  const handleOpenFile = useCallback((filePath) => {
    setOpenTabs((prev) => {
      if (prev.includes(filePath)) return prev;
      return [...prev, filePath];
    });
    setActivePath(filePath);
  }, []);

  // Handle Tab Close
  function handleCloseTab(filePath) {
    const nextTabs = openTabs.filter((t) => t !== filePath);
    setOpenTabs(nextTabs);

    if (activePath === filePath) {
      setActivePath(nextTabs[nextTabs.length - 1] || null);
    }
  }

  // Handle Editor Content Change
  function handleContentChange(newContent) {
    if (!activePath) return;

    setEditorContents((prev) => ({ ...prev, [activePath]: newContent }));
    setUnsavedPaths((prev) => {
      const updated = new Set(prev);
      updated.add(activePath);
      return updated;
    });
    setSaveStatus("unsaved");
  }

  // Handle Save File with OCC
  async function handleSaveCurrentFile() {
    if (!activePath || saveStatus === "saving") return;

    const currentContent = editorContents[activePath];
    const expectedHash = serverHashes[activePath] || null;

    setSaveStatus("saving");
    setSaveError("");

    try {
      const savedResult = await saveWorkspaceFile(
        workspaceId,
        activePath,
        currentContent,
        expectedHash
      );

      // Update server content hash with new hash
      setServerHashes((prev) => ({ ...prev, [activePath]: savedResult.contentHash }));
      setUnsavedPaths((prev) => {
        const updated = new Set(prev);
        updated.delete(activePath);
        return updated;
      });

      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2500);

      // Refresh files list and diff
      queryClient.invalidateQueries(["workspace-files", workspaceId]);
      queryClient.invalidateQueries(["workspace-diff", workspaceId]);
    } catch (err) {
      setSaveStatus("error");

      // Check for OCC 409 Conflict
      if (err.response?.status === 409 || err.code === "STALE_FILE_EDIT") {
        setConflictData({
          filePath: activePath,
          expectedHash,
          serverHash: err.response?.data?.error?.details?.currentHash || "modified-remotely",
        });
      } else {
        setSaveError(err.response?.data?.error?.message || err.customMessage || "Failed to save file.");
      }
    }
  }

  // Handle Create File
  async function handleCreateFile(filePath) {
    try {
      await saveWorkspaceFile(workspaceId, filePath, "");
      await refetchFiles();
      handleOpenFile(filePath);
    } catch (err) {
      alert(err.response?.data?.error?.message || err.customMessage || "Failed to create file.");
    }
  }

  // Handle Delete File
  async function handleConfirmDelete() {
    if (!confirmDeletePath) return;
    try {
      await deleteWorkspaceFile(workspaceId, confirmDeletePath);
      handleCloseTab(confirmDeletePath);
      setConfirmDeletePath(null);
      await refetchFiles();
      queryClient.invalidateQueries(["workspace-diff", workspaceId]);
    } catch (err) {
      alert(err.response?.data?.error?.message || err.customMessage || "Failed to delete file.");
    }
  }

  // Handle Reload Server Content (After conflict)
  async function handleReloadServerContent() {
    if (!conflictData) return;
    try {
      const fileRecord = await getWorkspaceFile(workspaceId, conflictData.filePath);
      setEditorContents((prev) => ({ ...prev, [conflictData.filePath]: fileRecord.content }));
      setServerHashes((prev) => ({ ...prev, [conflictData.filePath]: fileRecord.contentHash }));
      setUnsavedPaths((prev) => {
        const updated = new Set(prev);
        updated.delete(conflictData.filePath);
        return updated;
      });
      setConflictData(null);
      setSaveStatus("idle");
    } catch {
      alert("Failed to reload server version.");
    }
  }

  // Checkpoint Mutations
  const createCpMutation = useMutation({
    mutationFn: ({ name, description }) =>
      createWorkspaceCheckpoint(workspaceId, { name, description }),
    onSuccess: () => {
      refetchCheckpoints();
    },
  });

  const restoreCpMutation = useMutation({
    mutationFn: (checkpointId) =>
      restoreWorkspaceCheckpoint(workspaceId, checkpointId),
    onSuccess: () => {
      refetchFiles();
      refetchDiff();
      setEditorContents({});
      setServerHashes({});
      setUnsavedPaths(new Set());
      setOpenTabs([]);
      setActivePath(null);
      alert("Workspace files successfully restored to checkpoint state.");
    },
  });

  // Publishing Mutations
  const publishMutation = useMutation({
    mutationFn: (payload) => publishWorkspaceChanges(workspaceId, payload),
    onSuccess: () => {
      refetchDiff();
      refetchFiles();
    },
  });

  const createPRMutation = useMutation({
    mutationFn: (payload) => createPullRequest(workspaceId, payload),
  });

  if (loadingWorkspace) {
    return (
      <div className="p-12 border border-[#E5E5E2] rounded-md bg-white">
        <LoadingSpinner label="Loading workspace..." />
      </div>
    );
  }

  if (workspaceError || !workspace) {
    return (
      <ErrorState
        title="Workspace Inaccessible"
        message={
          workspaceError?.response?.data?.error?.message ||
          "Workspace could not be found or you do not have permission to view it."
        }
        onRetry={refetchWorkspace}
      />
    );
  }

  return (
    <div className="h-[calc(100vh-7rem)] flex flex-col space-y-2 min-h-0 select-none">
      {/* Workspace Top Toolbar */}
      <div className="h-10 px-3 border border-[#E5E5E2] rounded-t-md bg-white flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Link
            to={`/app/repositories/${workspace.repositoryId}`}
            className="text-[#5F6368] hover:text-[#202124] p-1 rounded"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>

          <span className="font-bold text-xs text-[#202124]">{workspace.name}</span>
          <Badge variant="default" className="text-[10px] font-mono py-0">
            Base: {workspace.baseCommitSha ? workspace.baseCommitSha.slice(0, 7) : "unpinned"}
          </Badge>

          {/* Save Status Pill */}
          {saveStatus === "saving" && (
            <span className="text-[11px] text-[#6D5CE8] flex items-center gap-1">
              <span className="animate-spin text-xs">⟳</span> Saving...
            </span>
          )}
          {saveStatus === "saved" && (
            <span className="text-[11px] text-[#25845B] flex items-center gap-1 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" /> Saved
            </span>
          )}
          {saveStatus === "unsaved" && (
            <span className="text-[11px] text-[#D97706] flex items-center gap-1 font-medium">
              ● Unsaved changes
            </span>
          )}
          {saveStatus === "error" && (
            <span className="text-[11px] text-[#C84C4C] flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" /> {saveError || "Save failed"}
            </span>
          )}
        </div>

        {/* Toolbar Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Manual Save Button */}
          <Button
            size="sm"
            variant="secondary"
            onClick={handleSaveCurrentFile}
            disabled={!activePath || saveStatus === "saving"}
            className="h-7 text-xs gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save</span>
          </Button>

          {/* Toggle Diff Panel */}
          <Button
            size="sm"
            variant={activeBottomPanel === "diff" ? "default" : "outline"}
            onClick={() => setActiveBottomPanel((prev) => (prev === "diff" ? null : "diff"))}
            className="h-7 text-xs gap-1.5"
          >
            <GitCompare className="w-3.5 h-3.5" />
            <span>Diffs</span>
            {diffData?.summary && (
              <span className="font-mono text-[10px] ml-0.5 opacity-80">
                +{diffData.summary.totalAdditions}/-{diffData.summary.totalDeletions}
              </span>
            )}
          </Button>

          {/* Toggle Checkpoints Panel */}
          <Button
            size="sm"
            variant={activeBottomPanel === "checkpoints" ? "default" : "outline"}
            onClick={() => setActiveBottomPanel((prev) => (prev === "checkpoints" ? null : "checkpoints"))}
            className="h-7 text-xs gap-1.5"
          >
            <History className="w-3.5 h-3.5" />
            <span>Checkpoints</span>
          </Button>

          {/* Publish Changes Button */}
          <Button
            size="sm"
            variant="default"
            onClick={() => setIsPublishModalOpen(true)}
            disabled={!diffData || diffData.summary?.modifiedFilesCount === 0}
            className="h-7 text-xs gap-1.5 ml-2"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Publish PR</span>
          </Button>
        </div>
      </div>

      {/* Main Workspace Body: FileTree + Editor */}
      <div className="flex-1 flex border border-[#E5E5E2] bg-white rounded-b-md overflow-hidden min-h-0">
        {/* Left Workspace File Tree (240px) */}
        <div className="w-60 border-r border-[#E5E5E2] flex flex-col bg-[#F8F8F6]/40 shrink-0">
          <WorkspaceFileTree
            files={files}
            activePath={activePath}
            onSelectFile={handleOpenFile}
            onCreateFile={handleCreateFile}
            onDeleteFile={(filePath) => setConfirmDeletePath(filePath)}
            onInitFiles={() => initFilesMutation.mutate()}
            isInitializingFiles={initFilesMutation.isPending}
          />
        </div>

        {/* Center / Main Editor & Tabs */}
        <div className="flex-1 flex flex-col min-w-0 bg-white">
          <EditorTabs
            openTabs={openTabs}
            activePath={activePath}
            unsavedPaths={unsavedPaths}
            onSelectTab={setActivePath}
            onCloseTab={handleCloseTab}
          />

          <div className="flex-1 relative overflow-hidden">
            {activePath ? (
              <WorkspaceEditor
                filePath={activePath}
                content={editorContents[activePath] ?? ""}
                onChange={handleContentChange}
                onSave={handleSaveCurrentFile}
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center p-8 text-center text-xs text-[#80868B] select-none">
                <FileCode className="w-10 h-10 text-[#E5E5E2] mb-2" />
                <p>No file selected</p>
                <p className="text-[11px] text-[#A0A09C] mt-1">
                  Choose a file from the explorer on the left or click "New File" to begin.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Collapsible Panels: Diffs or Checkpoints */}
      {activeBottomPanel === "diff" && (
        <div className="h-64 border border-[#E5E5E2] rounded-md bg-white flex flex-col overflow-hidden shrink-0">
          <div className="h-8 px-3 border-b border-[#E5E5E2] bg-[#F8F8F6] flex items-center justify-between text-xs">
            <span className="font-bold text-[#202124] flex items-center gap-1.5">
              <GitCompare className="w-3.5 h-3.5 text-[#6D5CE8]" />
              Workspace Diffs vs Baseline
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActiveBottomPanel(null)}
              className="h-6 text-[11px] text-[#5F6368]"
            >
              Close
            </Button>
          </div>
          <div className="flex-1 overflow-auto p-2">
            <DiffViewer
              diffData={diffData}
              isLoading={loadingDiff}
              onRefresh={refetchDiff}
            />
          </div>
        </div>
      )}

      {activeBottomPanel === "checkpoints" && (
        <div className="h-64 border border-[#E5E5E2] rounded-md bg-white flex flex-col overflow-hidden shrink-0">
          <div className="h-8 px-3 border-b border-[#E5E5E2] bg-[#F8F8F6] flex items-center justify-between text-xs">
            <span className="font-bold text-[#202124] flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-[#6D5CE8]" />
              Workspace Checkpoints
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActiveBottomPanel(null)}
              className="h-6 text-[11px] text-[#5F6368]"
            >
              Close
            </Button>
          </div>
          <div className="flex-1 overflow-auto p-2">
            <CheckpointPanel
              checkpoints={checkpoints}
              onCreateCheckpoint={(data) => createCpMutation.mutateAsync(data)}
              onRestoreCheckpoint={(id) => restoreCpMutation.mutateAsync(id)}
              creating={createCpMutation.isPending}
              restoring={restoreCpMutation.isPending}
            />
          </div>
        </div>
      )}

      {/* Publishing Modal */}
      <PublishingModal
        isOpen={isPublishModalOpen}
        onClose={() => setIsPublishModalOpen(false)}
        workspace={workspace}
        diffData={diffData}
        onPublish={(payload) => publishMutation.mutateAsync(payload)}
        onCreatePR={(payload) => createPRMutation.mutateAsync(payload)}
        publishing={publishMutation.isPending}
        creatingPR={createPRMutation.isPending}
      />

      {/* Conflict Dialog Modal */}
      <ConflictDialog
        isOpen={Boolean(conflictData)}
        conflictData={conflictData}
        localContent={editorContents[activePath]}
        onReloadServer={handleReloadServerContent}
        onDismiss={() => setConflictData(null)}
      />

      {/* Delete File Confirmation Modal */}
      {confirmDeletePath && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E5E2] rounded-md shadow-lg max-w-sm w-full p-4 space-y-3 text-xs">
            <h3 className="font-bold text-sm text-[#202124]">Delete File?</h3>
            <p className="text-[#5F6368]">
              Are you sure you want to mark <span className="font-mono font-bold">{confirmDeletePath}</span> as deleted?
              This will be tracked as a deletion tombstone in diff reviews.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" size="sm" onClick={() => setConfirmDeletePath(null)}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={handleConfirmDelete}>
                Delete File
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Top-level WorkspacePage:
 * Distinguishes between workspace list/selection mode and single workspace editor mode.
 */
export function WorkspacePage() {
  const [searchParams] = useSearchParams();
  const params = useParams();

  const workspaceId = params.workspaceId || searchParams.get("workspaceId");

  if (!workspaceId) {
    return <WorkspaceListView />;
  }

  return <WorkspaceEditorView workspaceId={workspaceId} />;
}

export default WorkspacePage;
