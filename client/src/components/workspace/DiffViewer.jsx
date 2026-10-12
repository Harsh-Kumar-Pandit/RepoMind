import { useState } from "react";
import Badge from "../ui/Badge.jsx";
import { AlertTriangle } from "lucide-react";

export function DiffViewer({ diffData, loading = false, error = null }) {
  const [selectedDiffPath, setSelectedDiffPath] = useState(null);

  if (loading) {
    return <div className="p-8 text-center text-xs text-[#5F6368]">Generating unified diff against pinned baseline...</div>;
  }

  if (error) {
    return <div className="p-4 text-xs text-[#C84C4C]">{error}</div>;
  }

  if (!diffData || !diffData.files || diffData.files.length === 0) {
    return (
      <div className="p-8 text-center text-xs text-[#80868B]">
        No changes detected compared to baseline commit. Edit or add files to inspect diffs.
      </div>
    );
  }

  const { summary, files, baseCommitSha, isTruncated } = diffData;
  const activeDiffFile = files.find((f) => f.path === selectedDiffPath) || files.find((f) => f.status !== "UNCHANGED") || files[0];

  return (
    <div className="h-full flex flex-col min-h-0 bg-white text-xs">
      {/* Diff Summary Bar */}
      <div className="px-4 py-2 border-b border-[#E5E5E2] bg-[#F8F8F6] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-[#202124]">Diff Review</span>
          <span className="text-[#80868B] font-mono text-[10px]">
            Baseline: {baseCommitSha ? baseCommitSha.slice(0, 7) : "unpinned"}
          </span>
          <div className="flex items-center gap-1.5 ml-2">
            <span className="text-[#25845B] font-bold">+{summary.added} added</span>
            <span>•</span>
            <span className="text-[#D97706] font-bold">~{summary.modified} modified</span>
            <span>•</span>
            <span className="text-[#C84C4C] font-bold">-{summary.deleted} deleted</span>
          </div>
        </div>

        {isTruncated && (
          <Badge variant="warning" className="text-[10px] gap-1">
            <AlertTriangle className="w-3 h-3" />
            <span>Diff Output Truncated (Limits Exceeded)</span>
          </Badge>
        )}
      </div>

      {/* Main Diff Split: Changed Files List + Diff Content */}
      <div className="flex-1 flex min-h-0">
        {/* Changed Files List (220px) */}
        <div className="w-56 border-r border-[#E5E5E2] bg-[#F8F8F6]/30 overflow-y-auto p-1.5 shrink-0">
          <p className="text-[10px] uppercase font-bold text-[#80868B] px-2 py-1">Changed Files ({files.length})</p>
          {files.map((file) => {
            const isSelected = file.path === activeDiffFile?.path;
            const statusVariants = {
              ADDED: "text-[#25845B]",
              MODIFIED: "text-[#D97706]",
              DELETED: "text-[#C84C4C]",
              UNCHANGED: "text-[#80868B]",
            };

            return (
              <div
                key={file.path}
                onClick={() => setSelectedDiffPath(file.path)}
                className={`p-1.5 rounded cursor-pointer select-none font-mono text-xs flex items-center justify-between transition-colors ${
                  isSelected ? "bg-[#6D5CE8]/10 text-[#6D5CE8] font-bold" : "hover:bg-[#E5E5E2]/40 text-[#202124]"
                }`}
              >
                <span className="truncate pr-1">{file.path}</span>
                <span className={`text-[10px] font-bold ${statusVariants[file.status]}`}>
                  {file.status[0]}
                </span>
              </div>
            );
          })}
        </div>

        {/* Diff Content Viewer */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#F8F8F6]/10">
          {activeDiffFile ? (
            <>
              <div className="px-3 py-1.5 border-b border-[#E5E5E2] bg-white flex items-center justify-between font-mono text-xs">
                <span className="font-bold text-[#202124]">{activeDiffFile.path}</span>
                <Badge variant={activeDiffFile.status === "ADDED" ? "success" : activeDiffFile.status === "DELETED" ? "danger" : "default"}>
                  {activeDiffFile.status}
                </Badge>
              </div>

              <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed">
                {activeDiffFile.status === "UNCHANGED" ? (
                  <p className="text-[#80868B] text-center pt-8">This file has no changes compared to baseline.</p>
                ) : !activeDiffFile.diffText ? (
                  <p className="text-[#80868B] text-center pt-8">No diff representation available for this change.</p>
                ) : (
                  <div className="space-y-0.5">
                    {activeDiffFile.diffText.split("\n").map((line, idx) => {
                      const isAdd = line.startsWith("+") && !line.startsWith("+++");
                      const isDel = line.startsWith("-") && !line.startsWith("---");
                      const isHeader = line.startsWith("@@") || line.startsWith("---") || line.startsWith("+++");

                      return (
                        <div
                          key={idx}
                          className={`px-2 py-0.5 whitespace-pre ${
                            isAdd
                              ? "bg-[#25845B]/10 text-[#25845B]"
                              : isDel
                              ? "bg-[#C84C4C]/10 text-[#C84C4C]"
                              : isHeader
                              ? "text-[#6D5CE8] font-bold bg-[#6D5CE8]/5"
                              : "text-[#5F6368]"
                          }`}
                        >
                          {line}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="p-8 text-center text-xs text-[#80868B]">Select a changed file to inspect unified diff.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default DiffViewer;
