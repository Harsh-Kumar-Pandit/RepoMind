import { useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { listUserRepositories, getRepositoryIndexStatus } from "../services/repository.service.js";
import { sendChatMessage } from "../services/chat.service.js";
import Button from "../components/ui/Button.jsx";
import { LoadingSpinner } from "../components/shared/Loading.jsx";
import Notification from "../components/ui/Notification.jsx";
import {
  MessageSquare,
  Send,
  Sparkles,
  FileCode,
  Bot,
  User,
} from "lucide-react";

export function ChatPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedRepoId = searchParams.get("repositoryId") || "";

  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [chatError, setChatError] = useState("");

  // Fetch available repositories
  const { data: repositories = [] } = useQuery({
    queryKey: ["user-repositories"],
    queryFn: listUserRepositories,
  });

  const activeRepo = repositories.find((r) => r.id === selectedRepoId) || repositories[0] || null;
  const activeRepoId = activeRepo?.id;

  // Fetch index status for selected repository
  const { data: indexStatus, isLoading: loadingStatus } = useQuery({
    queryKey: ["repo-index-status", activeRepoId],
    queryFn: () => getRepositoryIndexStatus(activeRepoId),
    enabled: Boolean(activeRepoId),
  });

  const isReady = indexStatus?.status === "COMPLETED";

  // Chat Mutation
  const chatMutation = useMutation({
    mutationFn: (q) =>
      sendChatMessage({
        repositoryId: activeRepoId,
        question: q,
      }),
    onSuccess: (data) => {
      // Append assistant response
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer,
          citations: data.citations || [],
          timestamp: new Date().toISOString(),
        },
      ]);
    },
    onError: (err) => {
      setChatError(
        err.customMessage ||
          err.response?.data?.error?.message ||
          "Failed to generate answer. Ensure repository is indexed."
      );
    },
  });

  function handleSubmit(e) {
    e.preventDefault();
    if (!question.trim() || chatMutation.isPending) return;

    const userQuestion = question.trim();
    setQuestion("");
    setChatError("");

    // Append user message immediately
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: userQuestion,
        timestamp: new Date().toISOString(),
      },
    ]);

    chatMutation.mutate(userQuestion);
  }

  function handlePromptSuggestion(sample) {
    setQuestion(sample);
  }

  return (
    <div className="h-[calc(100vh-7rem)] flex flex-col space-y-3 max-w-4xl mx-auto">
      {/* Top Header: Repo Selector & AI Status */}
      <div className="flex items-center justify-between border-b border-[#E5E5E2] pb-3 shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-[#6D5CE8]" />
          <h2 className="text-sm font-bold text-[#202124]">Ask RepoMind</h2>
          <span className="text-xs text-[#80868B]">• Grounded Code AI</span>
        </div>

        {/* Repository Switcher */}
        {repositories.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#5F6368]">Repository:</span>
            <select
              value={activeRepoId || ""}
              onChange={(e) => {
                setSearchParams({ repositoryId: e.target.value });
                setMessages([]);
                setChatError("");
              }}
              className="text-xs font-mono bg-white border border-[#E5E5E2] rounded px-2 py-1 outline-none focus:border-[#6D5CE8]"
            >
              {repositories.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.owner}/{repo.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Index Warning Banner */}
      {!loadingStatus && indexStatus && !isReady && (
        <Notification
          type="info"
          title="Repository not fully indexed"
          message={`Indexing status is ${indexStatus.status}. AI answers are only available after code embeddings are generated.`}
          className="shrink-0"
        />
      )}

      {/* Chat Messages Body */}
      <div className="flex-1 border border-[#E5E5E2] rounded-md bg-white p-4 overflow-y-auto space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4">
            <div className="w-10 h-10 rounded-full bg-[#6D5CE8]/10 flex items-center justify-center text-[#6D5CE8]">
              <Sparkles className="w-5 h-5" />
            </div>

            <div>
              <h3 className="text-sm font-bold text-[#202124]">
                Ask questions about {activeRepo?.name || "this repository"}
              </h3>
              <p className="text-xs text-[#5F6368] max-w-md mt-1">
                RepoMind searches 768-dimensional code vectors to explain logic, find relevant files,
                and trace architecture. AI answers are strictly read-only.
              </p>
            </div>

            {/* Suggested Prompts */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg w-full text-left pt-2">
              {[
                "Explain the overall architecture of this repository.",
                "Where is authentication and session handling implemented?",
                "Which files define the core database schema?",
                "How are API errors structured and handled?",
              ].map((sample) => (
                <button
                  key={sample}
                  onClick={() => handlePromptSuggestion(sample)}
                  className="p-2.5 rounded border border-[#E5E5E2] bg-[#F8F8F6] text-xs text-[#202124] hover:border-[#6D5CE8] hover:bg-white text-left transition-all"
                >
                  <p className="line-clamp-2">{sample}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div key={idx} className="space-y-2">
              <div
                className={`flex gap-3 p-3.5 rounded-md text-xs leading-relaxed ${
                  msg.role === "user"
                    ? "bg-[#F8F8F6] text-[#202124] ml-8"
                    : "bg-white border border-[#E5E5E2] text-[#202124] mr-4 shadow-2xs"
                }`}
              >
                <div
                  className={`w-6 h-6 rounded flex items-center justify-center shrink-0 ${
                    msg.role === "user" ? "bg-[#17191D] text-white" : "bg-[#6D5CE8] text-white"
                  }`}
                >
                  {msg.role === "user" ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                </div>

                <div className="flex-1 space-y-2">
                  <div className="font-semibold text-[11px] text-[#5F6368]">
                    {msg.role === "user" ? "You" : "RepoMind Assistant"}
                  </div>

                  <div className="whitespace-pre-wrap font-sans">{msg.content}</div>

                  {/* Grounded Citations */}
                  {msg.citations && msg.citations.length > 0 && (
                    <div className="pt-2 border-t border-[#E5E5E2]/60 mt-3 space-y-1.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#80868B]">
                        Grounded Citations
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {msg.citations.map((cite, cIdx) => (
                          <Link
                            key={cIdx}
                            to={`/app/explorer/${activeRepoId}`}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#E5E5E2] bg-[#F8F8F6] text-[11px] font-mono text-[#5F6368] hover:border-[#6D5CE8] hover:text-[#202124] transition-colors"
                          >
                            <FileCode className="w-3 h-3 text-[#6D5CE8]" />
                            <span>
                              {cite.filePath}:{cite.startLine}-{cite.endLine}
                            </span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}

        {chatMutation.isPending && (
          <div className="p-3 bg-white border border-[#E5E5E2] rounded-md flex items-center gap-2 text-xs text-[#5F6368]">
            <LoadingSpinner size="sm" label="" />
            <span>Retrieving code chunks and generating grounded answer...</span>
          </div>
        )}

        {chatError && (
          <Notification type="error" title="Chat Error" message={chatError} />
        )}
      </div>

      {/* Message Composer */}
      <form onSubmit={handleSubmit} className="flex gap-2 shrink-0">
        <input
          type="text"
          placeholder={
            isReady
              ? "Ask a question about this repository's code..."
              : "Repository indexing pending..."
          }
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={chatMutation.isPending}
          className="flex-1 h-10 px-3 text-xs bg-white border border-[#E5E5E2] rounded outline-none focus:border-[#6D5CE8]"
        />

        <Button
          type="submit"
          size="default"
          disabled={!question.trim() || chatMutation.isPending}
          loading={chatMutation.isPending}
          className="h-10 px-4 text-xs gap-1.5"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Send</span>
        </Button>
      </form>
    </div>
  );
}

export default ChatPage;
