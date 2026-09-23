import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api";

const Dashboard = () => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const navigate = useNavigate();

    useEffect(() => {
        const fetchUser = async () => {
            try {
                const response = await api.get("/auth/me");
                setUser(response.data.user);
            } catch (error) {
                console.error("Not authenticated");

                // Automatically return to login page
                navigate("/");
            } finally {
                setLoading(false);
            }
        };

        fetchUser();
    }, [navigate]);

    if (loading) {
        return <div className="p-10 text-white">Loading...</div>;
    }

    if (!user) return null;

    return (
        <div className="min-h-screen bg-gray-950 text-white p-10">
            <h1 className="text-3xl font-bold">
                Welcome, {user.username}
            </h1>

            <img
                src={user.avatar}
                alt={user.username}
                className="mt-6 w-16 h-16 rounded-full"
            />
        </div>
    );
};

export default Dashboard;