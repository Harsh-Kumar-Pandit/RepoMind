import { useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  listUserRepositories,
  getRepositoryFileContent,
  getRepositoryTree,
} from "../services/repository.service.js";
import Button from "../components/ui/Button.jsx";
import Badge from "../components/ui/Badge.jsx";
import { LoadingSpinner } from "../components/shared/Loading.jsx";
import ErrorState from "../components/shared/ErrorState.jsx";
import {
  Folder,
  FileCode,
  ChevronRight,
  ChevronDown,
  Code2,
  ExternalLink,
  Search,
  ArrowLeft,
  FileText,
} from "lucide-react";

/**
 * Builds nested folder/file tree hierarchy from flat list of file paths.
 */
function buildTree(fileList) {
  const root = { name: "root", type: "dir", children: {} };

  for (const file of fileList) {
    const parts = file.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;

      if (isFile) {
        current.children[part] = {
          name: part,
          type: "file",
          path: file.path,
          size: file.size,
          language: file.language,
        };
      } else {
        if (!current.children[part]) {
          current.children[part] = {
            name: part,
            type: "dir",
            path: parts.slice(0, i + 1).join("/"),
            children: {},
          };
        }
        current = current.children[part];
      }
    }
  }

  return root;
}

export function RepositoryExplorerPage() {
  const { repositoryId } = useParams();
  const [selectedPath, setSelectedPath] = useState(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [openDirs, setOpenDirs] = useState({ "": true });

  // 1. Fetch repository record
  const { data: repositories = [], isLoading: loadingRepos } = useQuery({
    queryKey: ["user-repositories"],
    queryFn: listUserRepositories,
  });
  const repository = repositories.find((r) => r.id === repositoryId);

  // 2. Fetch repository file tree via getRepositoryTree (loads fast from DB snapshot)
  const {
    data: treeData,
    isLoading: loadingTree,
    error: treeError,
  } = useQuery({
    queryKey: ["repo-tree", repositoryId],
    queryFn: () => getRepositoryTree(repositoryId),
    enabled: Boolean(repositoryId),
  });

  const allFiles = useMemo(() => treeData?.files || [], [treeData?.files]);

  // Filter file list by search query
  const filteredFiles = useMemo(() => {
    if (!searchFilter.trim()) return allFiles;
    const q = searchFilter.toLowerCase();
    return allFiles.filter((f) => f.path.toLowerCase().includes(q));
  }, [allFiles, searchFilter]);

  const treeRoot = useMemo(() => buildTree(filteredFiles), [filteredFiles]);

  // Set default selected file to README or first file
  const activePath = selectedPath || filteredFiles[0]?.path || null;

  const commitSha = treeData?.commitSha || null;

  // 3. Fetch content for active selected file
  const {
    data: fileData,
    isLoading: loadingFile,
    error: fileError,
  } = useQuery({
    queryKey: ["repo-file-content", repositoryId, activePath, commitSha],
    queryFn: () => getRepositoryFileContent(repositoryId, activePath, commitSha),
    enabled: Boolean(repositoryId && activePath),
  });

  function toggleDir(path) {
    setOpenDirs((prev) => ({ ...prev, [path]: !prev[path] }));
  }

  function renderTreeNodes(node, depth = 0) {
    const keys = Object.keys(node.children).sort((a, b) => {
      const isDirA = node.children[a].type === "dir";
      const isDirB = node.children[b].type === "dir";
      if (isDirA && !isDirB) return -1;
      if (!isDirA && isDirB) return 1;
      return a.localeCompare(b);
    });

    return keys.map((key) => {
      const item = node.children[key];
      const isDir = item.type === "dir";
      const isOpen = Boolean(openDirs[item.path]);
      const isSelected = item.path === activePath;

      if (isDir) {
        return (
          <div key={item.path}>
            <div
              onClick={() => toggleDir(item.path)}
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
              className="flex items-center gap-1.5 py-1 px-2 text-xs text-[#5F6368] hover:bg-[#E5E5E2]/40 rounded cursor-pointer select-none font-medium"
            >
              {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              <Folder className="w-3.5 h-3.5 text-[#80868B]" />
              <span className="truncate">{item.name}</span>
            </div>
            {isOpen && renderTreeNodes(item, depth + 1)}
          </div>
        );
      }

      return (
        <div
          key={item.path}
          onClick={() => setSelectedPath(item.path)}
          style={{ paddingLeft: `${depth * 12 + 18}px` }}
          className={`flex items-center gap-1.5 py-1 px-2 text-xs rounded cursor-pointer select-none font-mono transition-colors ${
            isSelected
              ? "bg-[#6D5CE8]/10 text-[#6D5CE8] font-bold"
              : "text-[#202124] hover:bg-[#E5E5E2]/40"
          }`}
        >
          <FileCode className="w-3.5 h-3.5 shrink-0 opacity-70" />
          <span className="truncate">{item.name}</span>
        </div>
      );
    });
  }

  if (loadingRepos) {
    return (
      <div className="p-12 border border-[#E5E5E2] rounded-md bg-white">
        <LoadingSpinner label="Loading repository..." />
      </div>
    );
  }

  if (!repository) {
    return <ErrorState title="Repository Not Found" message="Repository ID could not be loaded." />;
  }

  return (
    <div className="h-[calc(100vh-7rem)] flex flex-col space-y-3">
      {/* Top Breadcrumb & Metadata Bar */}
      <div className="flex items-center justify-between border-b border-[#E5E5E2] pb-3 shrink-0">
        <div className="flex items-center gap-2">
          <Link to={`/app/repositories/${repository.id}`} className="text-[#5F6368] hover:text-[#202124]">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h2 className="text-sm font-bold text-[#202124] flex items-center gap-1.5 font-mono">
            <span>{repository.owner}/{repository.name}</span>
            <span className="text-[#80868B] font-sans font-normal text-xs">• Explorer (Read-Only)</span>
          </h2>
          <Badge variant="default" className="text-[10px]">
            {repository.defaultBranch}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          {activePath && (
            <Link to={`/app/workspaces?repositoryId=${repository.id}&filePath=${encodeURIComponent(activePath)}`}>
              <Button size="sm" variant="secondary" className="h-7 text-xs gap-1.5">
                <Code2 className="w-3.5 h-3.5" />
                <span>Open in Workspace</span>
              </Button>
            </Link>
          )}

          <a
            href={repository.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[#5F6368] hover:text-[#202124] flex items-center gap-1"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Main Split Explorer: Sidebar Tree + Content Pane */}
      <div className="flex-1 flex border border-[#E5E5E2] rounded-md bg-white overflow-hidden min-h-0">
        {/* Left Tree Pane (260px) */}
        <div className="w-64 border-r border-[#E5E5E2] flex flex-col bg-[#F8F8F6]/50 shrink-0">
          <div className="p-2.5 border-b border-[#E5E5E2]">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-[#80868B]" />
              <input
                type="text"
                placeholder="Search files..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="w-full h-7 pl-8 pr-2 text-xs rounded border border-[#E5E5E2] bg-white outline-none focus:border-[#6D5CE8]"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-1.5">
            {loadingTree ? (
              <div className="p-8 flex items-center justify-center">
                <LoadingSpinner label="Loading file tree..." />
              </div>
            ) : treeError ? (
              <p className="text-xs text-[#C84C4C] p-4 text-center">
                Failed to load file tree: {treeError.response?.data?.error?.message || "Error loading tree"}
              </p>
            ) : filteredFiles.length === 0 ? (
              <div className="p-4 text-center space-y-2">
                <p className="text-xs text-[#80868B]">
                  {searchFilter.trim() ? `No files matching "${searchFilter}"` : "No files available"}
                </p>
                {searchFilter.trim() && (
                  <button
                    type="button"
                    onClick={() => setSearchFilter("")}
                    className="text-[11px] text-[#6D5CE8] hover:underline block mx-auto"
                  >
                    Clear filter
                  </button>
                )}
              </div>
            ) : (
              renderTreeNodes(treeRoot)
            )}
          </div>
        </div>

        {/* Right Code Content Pane */}
        <div className="flex-1 flex flex-col min-w-0 bg-white">
          {activePath ? (
            <>
              {/* File Header Bar */}
              <div className="h-9 px-4 border-b border-[#E5E5E2] bg-[#F8F8F6] flex items-center justify-between text-xs text-[#5F6368] font-mono shrink-0">
                <div className="flex items-center gap-2 truncate">
                  <FileText className="w-3.5 h-3.5 text-[#80868B]" />
                  <span className="text-[#202124] font-medium truncate">{activePath}</span>
                </div>
                <Badge variant="default" className="text-[10px] font-sans">
                  Read-Only Preview
                </Badge>
              </div>

              {/* File Content Body */}
              <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-[#202124]">
                {loadingFile ? (
                  <div className="h-full flex items-center justify-center">
                    <LoadingSpinner label="Fetching file content..." />
                  </div>
                ) : fileError ? (
                  <div className="p-6 text-center text-[#C84C4C] text-xs">
                    Failed to fetch file content: {fileError.response?.data?.error?.message || fileError.message || "File unavailable"}
                  </div>
                ) : (
                  <pre className="m-0 whitespace-pre">
                    <code>{fileData?.content}</code>
                  </pre>
                )}
              </div>
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-[#80868B]">
              Select a file from the tree to preview its content.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default RepositoryExplorerPage;
