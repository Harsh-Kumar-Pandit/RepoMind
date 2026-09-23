import React from "react";

const Login = () => {
    const handleGithubLogin = () => {
        window.location.href = "http://localhost:5000/api/auth/github";
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-950 text-white">
            <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-8 text-center">
                <h1 className="text-3xl font-bold mb-3">
                    RepoMind
                </h1>

                <p className="text-gray-400 mb-8">
                    AI-powered GitHub code workspace
                </p>

                <button
                    onClick={handleGithubLogin}
                    className="w-full rounded-lg bg-white px-4 py-3 font-medium text-black hover:bg-gray-200"
                >
                    Continue with GitHub
                </button>
            </div>
        </div>
    );
};

export default Login;