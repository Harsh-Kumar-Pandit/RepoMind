import { useState } from "react";
import Button from "../components/ui/Button.jsx";
import Input from "../components/ui/Input.jsx";
import Badge from "../components/ui/Badge.jsx";
import Notification from "../components/ui/Notification.jsx";
import EmptyState from "../components/shared/EmptyState.jsx";
import ErrorState from "../components/shared/ErrorState.jsx";
import { LoadingSkeleton } from "../components/shared/Loading.jsx";
import { FolderGit2 } from "lucide-react";

export function DesignSystemShowcase() {
  const [inputValue, setInputValue] = useState("");
  const [loadingBtn, setLoadingBtn] = useState(false);

  return (
    <div className="max-w-4xl mx-auto space-y-10 py-6">
      <div>
        <h1 className="text-2xl font-bold text-[#202124]">Design System Showcase</h1>
        <p className="text-xs text-[#5F6368] mt-1">
          RepoMind visual identity and UI primitives specification.
        </p>
      </div>

      {/* Colors & Tokens */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[#5F6368]">Color Palette</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3">
          <div className="p-3 rounded border border-[#E5E5E2] bg-[#F8F8F6]">
            <p className="text-xs font-semibold">Warm White</p>
            <p className="text-[10px] font-mono text-[#5F6368]">#F8F8F6</p>
          </div>
          <div className="p-3 rounded bg-[#17191D] text-white">
            <p className="text-xs font-semibold">Graphite</p>
            <p className="text-[10px] font-mono text-[#9CA3AF]">#17191D</p>
          </div>
          <div className="p-3 rounded bg-[#202124] text-white">
            <p className="text-xs font-semibold">Text Primary</p>
            <p className="text-[10px] font-mono text-[#9CA3AF]">#202124</p>
          </div>
          <div className="p-3 rounded bg-[#6D5CE8] text-white">
            <p className="text-xs font-semibold">Muted Violet</p>
            <p className="text-[10px] font-mono text-purple-200">#6D5CE8</p>
          </div>
          <div className="p-3 rounded border border-[#D1D1CD] bg-white">
            <p className="text-xs font-semibold">Subtle Border</p>
            <p className="text-[10px] font-mono text-[#5F6368]">#E5E5E2</p>
          </div>
          <div className="p-3 rounded bg-[#25845B] text-white">
            <p className="text-xs font-semibold">Success Green</p>
            <p className="text-[10px] font-mono text-green-200">#25845B</p>
          </div>
          <div className="p-3 rounded bg-[#C84C4C] text-white">
            <p className="text-xs font-semibold">Destructive Red</p>
            <p className="text-[10px] font-mono text-red-200">#C84C4C</p>
          </div>
        </div>
      </section>

      {/* Buttons */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[#5F6368]">Buttons</h2>
        <div className="flex flex-wrap gap-3 items-center">
          <Button variant="default">Primary Action</Button>
          <Button variant="secondary">Secondary Action</Button>
          <Button variant="ghost">Ghost Button</Button>
          <Button variant="destructive">Destructive Action</Button>
          <Button
            loading={loadingBtn}
            onClick={() => {
              setLoadingBtn(true);
              setTimeout(() => setLoadingBtn(false), 1500);
            }}
          >
            Click for Loading State
          </Button>
          <Button disabled>Disabled Button</Button>
        </div>
      </section>

      {/* Badges */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[#5F6368]">Badges</h2>
        <div className="flex flex-wrap gap-2 items-center">
          <Badge variant="default">main</Badge>
          <Badge variant="violet">768-dim RAG</Badge>
          <Badge variant="success">COMPLETED</Badge>
          <Badge variant="warning">INDEXING</Badge>
          <Badge variant="danger">CONFLICT 409</Badge>
        </div>
      </section>

      {/* Inputs & Form Elements */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[#5F6368]">Inputs</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
          <div>
            <label className="text-xs font-semibold text-[#202124] block mb-1">Standard Input</label>
            <Input
              placeholder="e.g. branch-name"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#C84C4C] block mb-1">Input with Error</label>
            <Input error defaultValue="invalid..branch.lock" />
          </div>
        </div>
      </section>

      {/* Notifications / Alerts */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[#5F6368]">Notifications</h2>
        <div className="space-y-3 max-w-lg">
          <Notification
            type="info"
            title="Baseline Pinned"
            message="Workspace is locked to commit 31bd4ce. Changes will be diffed against this baseline."
          />
          <Notification
            type="success"
            title="Checkpoint Created"
            message="Snapshot saved with 14 files. Point-in-time state can be restored anytime."
          />
          <Notification
            type="error"
            title="Stale File Edit (409)"
            message="This file was updated by another session. Local edits preserved for manual review."
          />
        </div>
      </section>

      {/* States: Empty, Loading, Error */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[#5F6368]">State Components</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <EmptyState
            icon={FolderGit2}
            title="No Workspaces Found"
            description="Create an editable workspace to start making manual code adjustments."
            actionText="New Workspace"
            onAction={() => alert("Action triggered")}
          />
          <ErrorState
            title="Repository Inaccessible"
            message="Unable to load repository tree due to GitHub rate limits."
            onRetry={() => alert("Retry clicked")}
          />
        </div>

        <div className="p-4 border border-[#E5E5E2] rounded bg-white space-y-2">
          <p className="text-xs font-semibold text-[#202124]">Loading Skeletons</p>
          <LoadingSkeleton className="h-5 w-3/4" />
          <LoadingSkeleton className="h-4 w-1/2" />
          <LoadingSkeleton className="h-4 w-5/6" />
        </div>
      </section>
    </div>
  );
}

export default DesignSystemShowcase;
