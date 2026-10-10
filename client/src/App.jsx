import { useState } from "react";
import { analyzeRepository } from "./services/repository";
import { readRepositoryFile } from "./services/files";

export default function App() {
  const [url, setUrl] = useState("");
  const [repository, setRepository] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
const [fileLoading, setFileLoading] = useState(false);
const [fileError, setFileError] = useState("");

  async function handleAnalyze(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setRepository(null);
    setFiles([]);

    try {
      const data = await analyzeRepository(url);
      setRepository(data.repository);
      setFiles(data.tree ?? []);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Failed to analyze repository."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleFileClick(path, type) {
  if (type !== "blob") return;

  setFileLoading(true);
  setFileError("");
  setSelectedFile(null);

  try {
    const file = await readRepositoryFile(url, path);
    setSelectedFile(file);
  } catch (error) {
    setFileError(
      error.response?.data?.message ||
        "Unable to load file."
    );
  } finally {
    setFileLoading(false);
  }
}

  return (
    <main className="min-h-screen bg-zinc-950 p-6 text-white md:p-12">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-bold">
          RepoMind
        </h1>

        <p className="mt-2 text-zinc-400">
          Understand any GitHub repository with AI.
        </p>

        <form
          onSubmit={handleAnalyze}
          className="mt-8 flex flex-col gap-3 sm:flex-row"
        >
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/facebook/react"
            className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 outline-none focus:border-blue-500"
          />

          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-blue-600 px-6 py-3 font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? "Analyzing..." : "Analyze Repository"}
          </button>
        </form>

        {error && (
          <p className="mt-4 text-red-400">{error}</p>
        )}

        {repository && (
          <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <h2 className="text-xl font-semibold">
              {repository.fullName}
            </h2>

            <p className="mt-2 text-sm text-zinc-400">
              {repository.description ||
                "No description available"}
            </p>

            <p className="mt-3 text-sm text-zinc-400">
              Default branch: {repository.defaultBranch}
            </p>

            <h3 className="mt-6 font-semibold">
              Repository files ({files.length})
            </h3>

            <ul className="mt-3 space-y-2">
              {files.slice(0, 100).map((file) => (
                <li
                  key={file.path}
                  className="rounded-md bg-zinc-800 px-3 py-2 text-sm"
                >
                  {file.type === "tree" ? "📁" : "📄"}{" "}
                  {file.path}
                </li>
              ))}
            </ul>

            {files.length > 100 && (
              <p className="mt-3 text-sm text-zinc-400">
                Showing the first 100 entries.
              </p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}