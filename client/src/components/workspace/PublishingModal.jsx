import { useState } from "react";
import Button from "../ui/Button.jsx";
import Input from "../ui/Input.jsx";
import Badge from "../ui/Badge.jsx";
import Notification from "../ui/Notification.jsx";
import {
  Upload,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Info,
  Check,
} from "lucide-react";

/**
 * PublishingModal
 * Enables selective manual publishing to a feature branch and opening a pull request.
 * Strict rules:
 * - Direct pushing to base/default branch is prohibited.
 * - Only user-selected changes are published.
 * - AI cannot trigger or modify this flow.
 * - Clear confirmation step before submitting.
 */
export function PublishingModal({
  isOpen,
  onClose,
  workspace,
  diffData,
  onPublish,
  onCreatePR,
  publishing = false,
  creatingPR = false,
}) {
  const [step, setStep] = useState("select"); // 'select' | 'configure' | 'success'
  const [selectedPaths, setSelectedPaths] = useState(() => {
    if (!diffData?.files) return [];
    return diffData.files.filter((f) => f.status !== "UNCHANGED").map((f) => f.path);
  });
  const [branchName, setBranchName] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [autoCreatePR, setAutoCreatePR] = useState(true);

  const [publishResult, setPublishResult] = useState(null);
  const [prResult, setPrResult] = useState(null);
  const [publishError, setPublishError] = useState(null);

  if (!isOpen) return null;

  const changedFiles = diffData?.files?.filter((f) => f.status !== "UNCHANGED") || [];
  const defaultBranch = workspace?.repository?.defaultBranch || "main";

  // Toggle single file selection
  function togglePath(path) {
    setSelectedPaths((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    );
  }

  // Toggle select all changed files
  function toggleSelectAll() {
    if (selectedPaths.length === changedFiles.length) {
      setSelectedPaths([]);
    } else {
      setSelectedPaths(changedFiles.map((f) => f.path));
    }
  }

  // Handle publishing submit
  async function handleProceedPublish() {
    setPublishError(null);
    try {
      const res = await onPublish({
        branchName: branchName.trim(),
        commitMessage: commitMessage.trim(),
        selectedPaths,
        baseBranch: defaultBranch,
      });

      setPublishResult(res);

      if (autoCreatePR) {
        try {
          const pr = await onCreatePR({
            headBranch: branchName.trim(),
            baseBranch: defaultBranch,
            title: prTitle.trim() || commitMessage.trim(),
            body: prBody.trim() || `Automated PR from RepoMind workspace changes.\n\n### Published Files:\n${selectedPaths.map((p) => `- \`${p}\``).join("\n")}`,
          });
          setPrResult(pr);
        } catch (prErr) {
          // Publishing succeeded, but PR creation had an issue (e.g. PR already exists)
          setPublishError({
            code: prErr.code || "PR_CREATION_FAILED",
            message: `Branch was successfully published, but Pull Request could not be created: ${prErr.customMessage || prErr.message}`,
            partial: true,
          });
        }
      }

      setStep("success");
    } catch (err) {
      setPublishError({
        code: err.code || "PUBLISH_FAILED",
        message: err.customMessage || err.message || "Failed to publish changes to GitHub.",
        partial: false,
      });
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white border border-[#E5E5E2] rounded-lg shadow-xl max-w-2xl w-full flex flex-col max-h-[90vh] text-xs">
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-[#E5E5E2] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-[#6D5CE8]/10 text-[#6D5CE8] flex items-center justify-center">
              <Upload className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-[#202124]">Publish Changes to GitHub</h2>
              <p className="text-[11px] text-[#5F6368]">
                Publish reviewed workspace modifications to a new feature branch and create a Pull Request.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#80868B] hover:text-[#202124] text-lg font-mono p-1 leading-none"
            disabled={publishing || creatingPR}
          >
            ×
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {publishError && (
            <Notification
              variant={publishError.partial ? "warning" : "error"}
              title={publishError.code}
            >
              {publishError.message}
            </Notification>
          )}

          {step === "select" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-[#E5E5E2]">
                <div>
                  <h3 className="font-semibold text-[#202124]">1. Select Changes to Publish</h3>
                  <p className="text-[#5F6368] text-[11px]">
                    Choose exactly which files from your workspace diff to include in this publish.
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={toggleSelectAll}>
                  {selectedPaths.length === changedFiles.length ? "Deselect All" : "Select All"}
                </Button>
              </div>

              {changedFiles.length === 0 ? (
                <div className="p-6 text-center text-[#80868B] bg-[#F8F8F6] rounded border border-[#E5E5E2]">
                  No modified or deleted files found in this workspace. Make edits before publishing.
                </div>
              ) : (
                <div className="border border-[#E5E5E2] rounded-md divide-y divide-[#E5E5E2] max-h-60 overflow-y-auto">
                  {changedFiles.map((file) => {
                    const isChecked = selectedPaths.includes(file.path);
                    const statusBadgeVariant =
                      file.status === "ADDED"
                        ? "success"
                        : file.status === "DELETED"
                        ? "danger"
                        : "warning";

                    return (
                      <div
                        key={file.path}
                        onClick={() => togglePath(file.path)}
                        className={`p-2.5 flex items-center justify-between cursor-pointer select-none hover:bg-[#F8F8F6] transition-colors ${
                          isChecked ? "bg-[#6D5CE8]/5" : ""
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-4 h-4 rounded border flex items-center justify-center ${
                              isChecked
                                ? "bg-[#6D5CE8] border-[#6D5CE8] text-white"
                                : "border-[#80868B]"
                            }`}
                          >
                            {isChecked && <Check className="w-3 h-3" />}
                          </div>
                          <span className="font-mono text-xs text-[#202124]">{file.path}</span>
                        </div>
                        <Badge variant={statusBadgeVariant} className="text-[10px]">
                          {file.status}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="p-3 bg-[#F8F8F6] rounded border border-[#E5E5E2] space-y-1 text-[#5F6368]">
                <div className="flex items-center gap-1.5 font-medium text-[#202124]">
                  <Info className="w-3.5 h-3.5 text-[#6D5CE8]" />
                  <span>Pinned Baseline Safety</span>
                </div>
                <p>
                  Base Commit SHA: <span className="font-mono text-[#202124]">{workspace?.baseCommitSha || "Unpinned"}</span>
                </p>
                <p>
                  Publishing creates a direct Git tree against this pinned baseline. If remote &apos;{defaultBranch}&apos; has moved, you will receive an OCC conflict.
                </p>
              </div>
            </div>
          )}

          {step === "configure" && (
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-[#202124]">2. Branch & Commit Configuration</h3>
                <p className="text-[#5F6368] text-[11px]">
                  Provide a new feature branch and describe your changes. Direct push to &apos;{defaultBranch}&apos; is blocked.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block font-medium text-[#202124] mb-1">
                    Feature Branch Name <span className="text-[#C84C4C]">*</span>
                  </label>
                  <Input
                    placeholder="e.g. feature/update-components"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <p className="text-[11px] text-[#80868B] mt-1">
                    Must be a valid Git ref. Cannot match target branch &apos;{defaultBranch}&apos;.
                  </p>
                </div>

                <div>
                  <label className="block font-medium text-[#202124] mb-1">
                    Commit Message <span className="text-[#C84C4C]">*</span>
                  </label>
                  <Input
                    placeholder="e.g. feat: integrate workspace file updates"
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                  />
                </div>

                <div className="pt-2 border-t border-[#E5E5E2] space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="autoPr"
                      checked={autoCreatePR}
                      onChange={(e) => setAutoCreatePR(e.target.checked)}
                      className="rounded border-[#80868B]"
                    />
                    <label htmlFor="autoPr" className="font-medium text-[#202124] cursor-pointer">
                      Create Pull Request automatically after publishing
                    </label>
                  </div>

                  {autoCreatePR && (
                    <div className="space-y-2 pl-6">
                      <div>
                        <label className="block text-[#5F6368] mb-1">PR Title</label>
                        <Input
                          placeholder="Defaults to commit message if blank"
                          value={prTitle}
                          onChange={(e) => setPrTitle(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-[#5F6368] mb-1">PR Description (Optional)</label>
                        <textarea
                          placeholder="Provide details for reviewers..."
                          value={prBody}
                          onChange={(e) => setPrBody(e.target.value)}
                          className="w-full h-16 p-2 rounded border border-[#E5E5E2] bg-white text-xs font-sans focus:outline-none focus:ring-1 focus:ring-[#6D5CE8]"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Final Confirmation Warning */}
                <div className="p-3 bg-[#D97706]/10 border border-[#D97706]/30 rounded text-[#D97706] flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Confirmation Summary:</span> You are about to publish{" "}
                    <span className="font-bold">{selectedPaths.length} file(s)</span> to new branch{" "}
                    <span className="font-mono font-bold">{branchName || "(unspecified)"}</span> on GitHub.
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === "success" && (
            <div className="space-y-5 text-center py-4">
              <div className="w-12 h-12 rounded-full bg-[#25845B]/10 text-[#25845B] mx-auto flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6" />
              </div>

              <div>
                <h3 className="font-bold text-base text-[#202124]">Publishing Complete!</h3>
                <p className="text-xs text-[#5F6368] mt-1">
                  Your manual workspace modifications have been pushed to GitHub.
                </p>
              </div>

              <div className="bg-[#F8F8F6] border border-[#E5E5E2] rounded-md p-4 max-w-md mx-auto text-left space-y-2 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-[#80868B]">Branch:</span>
                  <span className="font-bold text-[#202124]">{publishResult?.branchName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#80868B]">Commit:</span>
                  <span className="text-[#6D5CE8]">{publishResult?.commitSha?.slice(0, 7)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#80868B]">Files Published:</span>
                  <span className="text-[#202124]">{publishResult?.filesPublishedCount}</span>
                </div>
                {prResult && (
                  <div className="pt-2 border-t border-[#E5E5E2] flex justify-between items-center">
                    <span className="text-[#80868B]">Pull Request:</span>
                    <a
                      href={prResult.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#6D5CE8] font-bold underline flex items-center gap-1"
                    >
                      <span>#{prResult.prNumber}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-[#E5E5E2] bg-[#F8F8F6] flex items-center justify-between shrink-0">
          {step === "select" && (
            <>
              <span className="text-[#5F6368]">
                {selectedPaths.length} of {changedFiles.length} file(s) selected
              </span>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={selectedPaths.length === 0}
                  onClick={() => setStep("configure")}
                >
                  Configure Branch & PR
                </Button>
              </div>
            </>
          )}

          {step === "configure" && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setStep("select")} disabled={publishing}>
                Back
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={onClose} disabled={publishing}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!branchName.trim() || !commitMessage.trim()}
                  loading={publishing || creatingPR}
                  onClick={handleProceedPublish}
                  className="gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Confirm & Publish</span>
                </Button>
              </div>
            </>
          )}

          {step === "success" && (
            <div className="w-full flex justify-end">
              <Button size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PublishingModal;
