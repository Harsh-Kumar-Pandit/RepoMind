import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";

const Dashboard = () => {
    const [user, setUser] = useState(null);
    const [repositories, setRepositories] = useState([]);
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);

    const navigate = useNavigate();

    useEffect(() => {
        const fetchDashboard = async () => {
            try {
                const [userResponse, repositoriesResponse] = await Promise.all([
                    api.get("/auth/me"),
                    api.get("/repositories")
                ]);

                setUser(userResponse.data.user);
                setRepositories(repositoriesResponse.data.repositories);
            } catch (error) {
                console.error("Failed to load dashboard:", error);
                navigate("/");
            } finally {
                setLoading(false);
            }
        };

        fetchDashboard();
    }, [navigate]);

    const filteredRepositories = repositories.filter((repo) =>
        repo.name.toLowerCase().includes(search.toLowerCase())
    );

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
                Loading...
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-950 text-white p-8">
            <div className="max-w-6xl mx-auto">

                {/* Header */}
                <div className="flex items-center justify-between mb-10">
                    <div>
                        <h1 className="text-3xl font-bold">
                            Welcome, {user?.username}
                        </h1>
                        <p className="text-gray-400 mt-2">
                            Select a repository to start working with RepoMind.
                        </p>
                    </div>

                    <img
                        src={user?.avatar}
                        alt={user?.username}
                        className="w-12 h-12 rounded-full"
                    />
                </div>

                {/* Repository section */}
                <div>
                    <div className="flex items-center justify-between mb-5">
                        <h2 className="text-2xl font-semibold">
                            Your Repositories
                        </h2>

                        <span className="text-sm text-gray-400">
                            {repositories.length} repositories
                        </span>
                    </div>

                    {/* Search */}
                    <input
                        type="text"
                        placeholder="Search repositories..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full mb-6 rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 text-white outline-none focus:border-gray-600"
                    />

                    {/* Repository list */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {filteredRepositories.map((repo) => (
                            <div
                                key={repo.id}
                                className="rounded-xl border border-gray-800 bg-gray-900 p-5"
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h3 className="text-lg font-semibold">
                                            {repo.name}
                                        </h3>

                                        <p className="text-sm text-gray-500 mt-1">
                                            {repo.fullName}
                                        </p>
                                    </div>

                                    <span className="text-xs rounded-full border border-gray-700 px-2 py-1 text-gray-400">
                                        {repo.private ? "Private" : "Public"}
                                    </span>
                                </div>

                                <p className="text-sm text-gray-400 mt-4 min-h-10">
                                    {repo.description || "No description"}
                                </p>
                                <button
                                    className="mt-5 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-gray-200"
                                    onClick={() => {
                                        console.log("FULL REPO OBJECT:", repo);
                                        navigate(`/workspace/${repo.fullName}`);
                                    }}
                                >
                                    Open
                                </button>
                            </div>
                        ))}
                    </div>

                    {filteredRepositories.length === 0 && (
                        <div className="text-center py-12 text-gray-500">
                            No repositories found.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Dashboard;