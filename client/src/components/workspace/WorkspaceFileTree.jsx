import { useState, useMemo } from "react";
import {
  Folder,
  FileCode,
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  Search,
} from "lucide-react";

/**
 * Builds nested folder/file tree structure from workspace file records.
 */
function buildWorkspaceTree(files) {
  const root = { name: "root", type: "dir", children: {} };

  for (const file of files) {
    if (file.isDeleted) continue; // Skip tombstoned files in active tree

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
          contentHash: file.contentHash,
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

export function WorkspaceFileTree({
  files = [],
  activeFilePath,
  unsavedPaths = new Set(),
  onSelectFile,
  onCreateFile,
  onDeleteFile,
  onInitFiles,
  isInitializingFiles = false,
}) {
  const [search, setSearch] = useState("");
  const [openDirs, setOpenDirs] = useState({ "": true });
  const [showNewFileInput, setShowNewFileInput] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");
  const [newFileError, setNewFileError] = useState("");

  const filteredFiles = useMemo(() => {
    if (!search.trim()) return files;
    const q = search.toLowerCase();
    return files.filter((f) => f.path.toLowerCase().includes(q));
  }, [files, search]);

  const treeRoot = useMemo(() => buildWorkspaceTree(filteredFiles), [filteredFiles]);

  function toggleDir(path) {
    setOpenDirs((prev) => ({ ...prev, [path]: !prev[path] }));
  }

  function handleCreateSubmit(e) {
    e.preventDefault();
    const trimmed = newFilePath.trim();
    if (!trimmed) return;

    if (trimmed.startsWith("/") || trimmed.includes("..") || trimmed.includes("\\")) {
      setNewFileError("Path cannot start with '/' or contain '..' or '\\'");
      return;
    }

    onCreateFile(trimmed);
    setNewFilePath("");
    setNewFileError("");
    setShowNewFileInput(false);
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
      const isSelected = item.path === activeFilePath;
      const isUnsaved = unsavedPaths.has(item.path);

      if (isDir) {
        return (
          <div key={item.path}>
            <div
              onClick={() => toggleDir(item.path)}
              style={{ paddingLeft: `${depth * 10 + 6}px` }}
              className="flex items-center gap-1.5 py-1 px-1.5 text-xs text-[#5F6368] hover:bg-[#E5E5E2]/40 rounded cursor-pointer select-none font-medium"
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
          style={{ paddingLeft: `${depth * 10 + 16}px` }}
          className={`group flex items-center justify-between py-1 px-1.5 text-xs rounded cursor-pointer select-none font-mono transition-colors ${
            isSelected
              ? "bg-[#6D5CE8]/10 text-[#6D5CE8] font-bold"
              : "text-[#202124] hover:bg-[#E5E5E2]/40"
          }`}
          onClick={() => onSelectFile(item.path)}
        >
          <div className="flex items-center gap-1.5 truncate min-w-0">
            <FileCode className="w-3.5 h-3.5 shrink-0 opacity-70" />
            <span className="truncate">{item.name}</span>
            {isUnsaved && <span className="w-1.5 h-1.5 rounded-full bg-[#6D5CE8] shrink-0" title="Unsaved changes" />}
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteFile(item.path);
            }}
            className="opacity-0 group-hover:opacity-100 hover:text-[#C84C4C] p-0.5 rounded transition-opacity"
            title="Delete file"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      );
    });
  }

  return (
    <div className="w-60 border-r border-[#E5E5E2] bg-[#F8F8F6]/60 flex flex-col shrink-0 min-h-0 select-none">
      {/* Explorer Top Toolbar */}
      <div className="p-2 border-b border-[#E5E5E2] flex items-center justify-between gap-1">
        <span className="text-[11px] font-bold uppercase tracking-wider text-[#5F6368]">Files</span>

        <button
          onClick={() => setShowNewFileInput((prev) => !prev)}
          className="p-1 rounded text-[#5F6368] hover:text-[#202124] hover:bg-[#E5E5E2]/50"
          title="New File"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* New File Inline Form */}
      {showNewFileInput && (
        <form onSubmit={handleCreateSubmit} className="p-2 border-b border-[#E5E5E2] bg-white space-y-1">
          <input
            type="text"
            placeholder="src/utils/helper.js"
            value={newFilePath}
            onChange={(e) => {
              setNewFilePath(e.target.value);
              if (newFileError) setNewFileError("");
            }}
            autoFocus
            className="w-full text-xs font-mono h-7 px-2 border border-[#E5E5E2] rounded outline-none focus:border-[#6D5CE8]"
          />
          {newFileError && <p className="text-[10px] text-[#C84C4C]">{newFileError}</p>}
          <div className="flex justify-end gap-1 pt-1">
            <button
              type="button"
              onClick={() => {
                setShowNewFileInput(false);
                setNewFileError("");
              }}
              className="px-2 py-0.5 text-[10px] text-[#80868B] hover:text-[#202124]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-2 py-0.5 text-[10px] bg-[#6D5CE8] text-white rounded font-medium"
            >
              Create
            </button>
          </div>
        </form>
      )}

      {/* File Search */}
      <div className="p-1.5 border-b border-[#E5E5E2]">
        <div className="relative">
          <Search className="w-3 h-3 absolute left-2 top-2 text-[#80868B]" />
          <input
            type="text"
            placeholder="Filter files..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-6.5 pl-6 pr-2 text-xs rounded border border-[#E5E5E2] bg-white outline-none focus:border-[#6D5CE8]"
          />
        </div>
      </div>

      {/* Tree Node List */}
      <div className="flex-1 overflow-y-auto p-1">
        {files.length === 0 ? (
          <div className="p-4 text-center text-xs text-[#80868B] space-y-3">
            <p>No files in workspace yet.</p>
            {onInitFiles && (
              <button
                type="button"
                onClick={onInitFiles}
                disabled={isInitializingFiles}
                className="w-full py-1.5 px-2 bg-[#6D5CE8] text-white hover:bg-[#5B4BC4] disabled:opacity-50 text-[11px] font-medium rounded transition-colors shadow-sm flex items-center justify-center gap-1.5"
              >
                {isInitializingFiles ? "Importing files..." : "Import Repository Baseline"}
              </button>
            )}
            <p className="text-[11px] text-[#80868B]">
              or click <span className="font-bold text-[#202124]">+</span> above to create a new file
            </p>
          </div>
        ) : (
          renderTreeNodes(treeRoot)
        )}
      </div>
    </div>
  );
}

export default WorkspaceFileTree;
