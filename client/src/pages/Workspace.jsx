import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../services/api";
import Editor from "@monaco-editor/react";

const FileTree = ({ nodes, level = 0, onFileClick }) => {
    return (
        <div>
            {nodes.map((node) => (
                <div key={node.path}>
                    <div
                        onClick={() => {
                            if (node.type === "blob" && onFileClick) {
                                onFileClick(node.path);
                            }
                        }}
                        className="flex items-center gap-2 rounded px-2 py-1 text-sm text-gray-300 hover:bg-gray-800 cursor-pointer"
                        style={{
                            paddingLeft: `${level * 16 + 8}px`
                        }}
                    >
                        <span>
                            {node.type === "tree" ? "📁" : "📄"}
                        </span>

                        <span className="truncate">
                            {node.name}
                        </span>
                    </div>

                    {node.children?.length > 0 && (
                        <FileTree
                            nodes={node.children}
                            level={level + 1}
                            onFileClick={onFileClick}
                        />
                    )}
                </div>
            ))}
        </div>
    );
};
const buildFileTree = (items) => {
    const root = [];

    items.forEach((item) => {
        const parts = item.path.split("/");
        let current = root;

        parts.forEach((part, index) => {
            const isLast = index === parts.length - 1;

            let existing = current.find(
                (node) => node.name === part
            );

            if (!existing) {
                existing = {
                    name: part,
                    path: parts.slice(0, index + 1).join("/"),
                    type: isLast ? item.type : "tree",
                    children: []
                };

                current.push(existing);
            }

            current = existing.children;
        });
    });

    return root;
};

const Workspace = () => {
    const { owner, repo } = useParams();
    const navigate = useNavigate();

    const [tree, setTree] = useState([]);
    const [fileTree, setFileTree] = useState([]); const [loadingFiles, setLoadingFiles] = useState(true);
    const [error, setError] = useState("");

    const [branches, setBranches] = useState([]);
    const [selectedBranch, setSelectedBranch] = useState("");

    const [selectedFile, setSelectedFile] = useState(null);
    const [fileContent, setFileContent] = useState("");
    const [originalContent, setOriginalContent] = useState("");
    const [loadingFile, setLoadingFile] = useState(false);
    const [isDirty, setIsDirty] = useState(false);

    useEffect(() => {
        const fetchRepositoryTree = async () => {
            setLoadingFiles(true);
            setError("");
            try {
                const response = await api.get(
                    `/repositories/${owner}/${repo}/tree`,
                    {
                        params: {
                            branch: selectedBranch || undefined
                        }
                    }
                );

                setTree(response.data.tree);
                setFileTree(buildFileTree(response.data.tree));
            } catch (error) {
                console.error("Failed to fetch repository tree:", error);
                setError("Failed to load repository files.");
            } finally {
                setLoadingFiles(false);
            }
        };

        fetchRepositoryTree();
    }, [owner, repo, selectedBranch]);

    useEffect(() => {
        const fetchBranches = async () => {
            try {
                const response = await api.get(
                    `/repositories/${owner}/${repo}/branches`
                );

                setBranches(response.data.branches);

                if (response.data.branches.length > 0) {
                    setSelectedBranch(response.data.branches[0].name);
                }
            } catch (error) {
                console.error("Failed to fetch branches:", error);
            }
        };

        fetchBranches();
    }, [owner, repo]);

    const handleFileSelection = (path) => {
        if (isDirty) {
            const confirmSwitch = window.confirm(
                "You have unsaved changes. Are you sure you want to switch files?"
            );

            if (!confirmSwitch) {
                return;
            }
        }

        handleFileClick(path);
    };

    const handleFileClick = async (path) => {
        try {
            setLoadingFile(true);
            setSelectedFile(path);

            const response = await api.get(
                `/repositories/${owner}/${repo}/file`,
                {
                    params: {
                        path,
                        branch: selectedBranch
                    }
                }
            );

            setFileContent(response.data.content);
            setOriginalContent(response.data.content);
            setIsDirty(false);
        } catch (error) {
            console.error("Failed to fetch file:", error);
            setFileContent("Failed to load file.");
        } finally {
            setLoadingFile(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-950 text-white">
            {/* Header */}
            <header className="border-b border-gray-800 bg-gray-900 px-6 py-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-bold">
                            RepoMind
                        </h1>

                        <p className="text-sm text-gray-400 mt-1">
                            {owner}/{repo}
                        </p>
                        <div className="mt-3">
                            <select
                                value={selectedBranch}
                                onChange={(e) => setSelectedBranch(e.target.value)}
                                className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
                            >
                                {branches.map((branch) => (
                                    <option key={branch.name} value={branch.name}>
                                        {branch.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <button
                        onClick={() => navigate("/dashboard")}
                        className="rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800"
                    >
                        Back to Repositories
                    </button>
                </div>
            </header>

            {/* Workspace */}
            <main className="p-6">
                <div className="grid grid-cols-12 gap-4 min-h-[calc(100vh-120px)]">

                    {/* File Explorer */}
                    <aside className="col-span-3 rounded-xl border border-gray-800 bg-gray-900 p-4">
                        <h2 className="font-semibold mb-4">
                            Files
                        </h2>
                        <div className="max-h-[calc(100vh-220px)] overflow-auto">
                            {loadingFiles && (
                                <p className="text-sm text-gray-500">
                                    Loading files...
                                </p>
                            )}

                            {error && (
                                <p className="text-sm text-red-400">
                                    {error}
                                </p>
                            )}

                            {!loadingFiles && !error && (
                                <FileTree
                                    nodes={fileTree}
                                    onFileClick={handleFileSelection}
                                />
                            )}
                        </div>
                    </aside>

                    {/* Editor */}
                    <section className="col-span-6 rounded-xl border border-gray-800 bg-gray-900 p-4">
                        <div className="mb-4 flex items-center justify-between">
                            <h2 className="font-semibold">
                                Editor
                            </h2>

                            {isDirty && (
                                <span className="text-sm text-yellow-400">
                                    ● Unsaved changes
                                </span>
                            )}
                        </div>
                        <div className="h-[80%] overflow-hidden rounded-lg bg-gray-950">
                            {loadingFile ? (
                                <div className="flex h-full items-center justify-center text-gray-500">
                                    Loading file...
                                </div>
                            ) : selectedFile ? (
                                <Editor
                                    height="100%"
                                    theme="vs-dark"
                                    value={fileContent}
                                    onChange={(value) => {
                                        const newContent = value || "";

                                        setFileContent(newContent);
                                        setIsDirty(newContent !== originalContent);
                                    }}
                                    options={{
                                        minimap: {
                                            enabled: false
                                        },
                                        fontSize: 14,
                                        wordWrap: "on",
                                        automaticLayout: true
                                    }}
                                />
                            ) : (
                                <div className="flex h-full items-center justify-center text-gray-500">
                                    Select a file to start editing.
                                </div>
                            )}
                        </div>
                    </section>

                    {/* AI Chat */}
                    <aside className="col-span-3 rounded-xl border border-gray-800 bg-gray-900 p-4">
                        <h2 className="font-semibold mb-4">
                            AI Assistant
                        </h2>

                        <p className="text-sm text-gray-500">
                            Ask RepoMind about your codebase.
                        </p>
                    </aside>

                </div>
            </main>
        </div>
    );
};

export default Workspace;