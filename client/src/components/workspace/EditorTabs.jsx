import { X, FileCode } from "lucide-react";

export function EditorTabs({
  openTabs = [],
  activePath,
  unsavedPaths = new Set(),
  onSelectTab,
  onCloseTab,
}) {
  if (openTabs.length === 0) return null;

  return (
    <div className="h-9 border-b border-[#E5E5E2] bg-[#F8F8F6] flex items-center overflow-x-auto no-scrollbar shrink-0 select-none">
      {openTabs.map((path) => {
        const isActive = path === activePath;
        const isUnsaved = unsavedPaths.has(path);
        const fileName = path.split("/").pop();

        return (
          <div
            key={path}
            onClick={() => onSelectTab(path)}
            className={`group h-full flex items-center gap-1.5 px-3 border-r border-[#E5E5E2] text-xs font-mono cursor-pointer transition-colors ${
              isActive
                ? "bg-white text-[#202124] border-t-2 border-t-[#6D5CE8] font-bold"
                : "text-[#5F6368] hover:bg-white hover:text-[#202124]"
            }`}
          >
            <FileCode className="w-3.5 h-3.5 opacity-70 shrink-0" />
            <span className="truncate max-w-[120px]">{fileName}</span>

            {/* Unsaved Dot or Close Button */}
            {isUnsaved ? (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(path);
                }}
                className="w-2 h-2 rounded-full bg-[#6D5CE8] hover:bg-[#C84C4C] shrink-0"
                title="Unsaved changes (click to close)"
              />
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(path);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 text-[#80868B] hover:text-[#202124] rounded shrink-0 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default EditorTabs;
