import Button from "../ui/Button.jsx";
import { AlertTriangle, RefreshCw } from "lucide-react";

export function ConflictDialog({
  isOpen,
  conflictData,
  localContent: _localContent,
  onReloadServer,
  onDismiss,
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white border border-[#E5E5E2] rounded-md shadow-lg max-w-lg w-full p-5 space-y-4 text-xs">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-[#C84C4C]/10 text-[#C84C4C] flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#202124]">
              Stale File Edit Detected (Conflict 409)
            </h3>
            <p className="text-xs text-[#5F6368] mt-1">
              This file was updated by another session or checkpoint restore since you opened it. To
              prevent silent overwrites, the server rejected this save.
            </p>
          </div>
        </div>

        <div className="bg-[#F8F8F6] p-3 rounded border border-[#E5E5E2] space-y-1 font-mono text-[11px]">
          <p className="text-[#5F6368]">
            File: <span className="text-[#202124] font-bold">{conflictData?.filePath}</span>
          </p>
          <p className="text-[#5F6368]">
            Expected Hash: <span className="text-[#C84C4C] truncate">{conflictData?.expectedHash?.slice(0, 16)}...</span>
          </p>
          <p className="text-[#5F6368]">
            Current Server Hash: <span className="text-[#25845B] truncate">{conflictData?.serverHash?.slice(0, 16)}...</span>
          </p>
        </div>

        <p className="text-[11px] text-[#5F6368]">
          Your unsaved changes in the editor have been preserved. You can continue editing your local
          copy, or reload the server version to synchronize.
        </p>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E5E5E2]">
          <Button variant="secondary" size="sm" onClick={onDismiss}>
            Keep Local Content
          </Button>

          <Button variant="destructive" size="sm" onClick={onReloadServer} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Overwrite Local with Server Version</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ConflictDialog;
