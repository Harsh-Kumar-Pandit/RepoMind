import { useState } from "react";
import Button from "../ui/Button.jsx";
import Input from "../ui/Input.jsx";
import Badge from "../ui/Badge.jsx";
import Notification from "../ui/Notification.jsx";
import { History, RotateCcw, Plus, Clock } from "lucide-react";

export function CheckpointPanel({
  checkpoints = [],
  onCreateCheckpoint,
  onRestoreCheckpoint,
  creating = false,
  restoring = false,
  error = null,
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [confirmRestoreId, setConfirmRestoreId] = useState(null);

  function handleCreate(e) {
    e.preventDefault();
    if (!name.trim()) return;

    onCreateCheckpoint({
      name: name.trim(),
      description: description.trim() || null,
    });

    setName("");
    setDescription("");
    setShowCreateForm(false);
  }

  function handleConfirmRestore(checkpointId) {
    onRestoreCheckpoint(checkpointId);
    setConfirmRestoreId(null);
  }

  return (
    <div className="h-full flex flex-col min-h-0 bg-white text-xs">
      {/* Checkpoint Header */}
      <div className="px-4 py-2.5 border-b border-[#E5E5E2] bg-[#F8F8F6] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <History className="w-4 h-4 text-[#6D5CE8]" />
          <span className="font-bold text-[#202124]">Checkpoints ({checkpoints.length}/20)</span>
        </div>

        {!showCreateForm && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShowCreateForm(true)}
            className="h-7 text-xs gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Checkpoint</span>
          </Button>
        )}
      </div>

      {/* Inline Create Form */}
      {showCreateForm && (
        <form onSubmit={handleCreate} className="p-3 border-b border-[#E5E5E2] bg-white space-y-2 shrink-0">
          <Input
            placeholder="Checkpoint name (e.g. before-auth-refactor)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-xs h-8"
            required
          />
          <Input
            placeholder="Optional description..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="text-xs h-7"
          />
          <div className="flex justify-end gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-2 py-1 text-xs text-[#5F6368] hover:text-[#202124]"
            >
              Cancel
            </button>
            <Button type="submit" size="sm" loading={creating} className="h-7 text-xs">
              Save Checkpoint
            </Button>
          </div>
        </form>
      )}

      {error && <Notification type="error" title="Checkpoint Error" message={error} className="m-3" />}

      {/* Checkpoint List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {checkpoints.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#80868B]">
            No checkpoints recorded yet. Save a checkpoint to capture a point-in-time manifest you can restore anytime.
          </div>
        ) : (
          checkpoints.map((cp) => {
            const isConfirming = confirmRestoreId === cp.id;

            return (
              <div
                key={cp.id}
                className="p-3 border border-[#E5E5E2] rounded bg-white hover:border-[#D1D1CD] transition-colors space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="font-bold text-[#202124] text-xs truncate">{cp.name}</h4>
                    {cp.description && <p className="text-[11px] text-[#5F6368] mt-0.5">{cp.description}</p>}
                  </div>

                  <Badge variant="default" className="text-[10px] shrink-0">
                    {cp.fileCount} files
                  </Badge>
                </div>

                <div className="flex items-center justify-between text-[11px] text-[#80868B] pt-1 border-t border-[#E5E5E2]/50">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>{new Date(cp.createdAt).toLocaleTimeString()}</span>
                  </span>

                  {isConfirming ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-[#C84C4C] font-semibold">Overwrite workspace?</span>
                      <button
                        onClick={() => handleConfirmRestore(cp.id)}
                        disabled={restoring}
                        className="px-2 py-0.5 bg-[#C84C4C] text-white rounded text-[10px] font-bold"
                      >
                        {restoring ? "Restoring..." : "Confirm"}
                      </button>
                      <button
                        onClick={() => setConfirmRestoreId(null)}
                        className="px-1.5 py-0.5 text-[10px] text-[#5F6368]"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmRestoreId(cp.id)}
                      className="h-6 text-[11px] text-[#6D5CE8] hover:text-[#5B4BC4] p-1 gap-1"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Restore</span>
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default CheckpointPanel;
