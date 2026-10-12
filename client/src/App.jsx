import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./contexts/AuthContext.jsx";

// Layouts
import PublicLayout from "./layouts/PublicLayout.jsx";
import AuthenticatedLayout from "./layouts/AuthenticatedLayout.jsx";

// Core Pages
import LandingPage from "./pages/LandingPage.jsx";
import DesignSystemShowcase from "./pages/DesignSystemShowcase.jsx";
import HomePage from "./pages/HomePage.jsx";
import RepositoriesPage from "./pages/RepositoriesPage.jsx";
import RepositoryOverviewPage from "./pages/RepositoryOverviewPage.jsx";
import RepositoryExplorerPage from "./pages/RepositoryExplorerPage.jsx";
import ChatPage from "./pages/ChatPage.jsx";

// Workspaces, Pull Requests, History, Settings (Attempt 3 & 4)
import WorkspacePage from "./pages/WorkspacePage.jsx";
import PullRequestsPage from "./pages/PullRequestsPage.jsx";
import HistoryPage from "./pages/HistoryPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public Routes */}
            <Route element={<PublicLayout />}>
              <Route path="/" element={<LandingPage />} />
              <Route path="/design-system" element={<DesignSystemShowcase />} />
            </Route>

            {/* Authenticated Application Shell */}
            <Route path="/app" element={<AuthenticatedLayout />}>
              <Route index element={<HomePage />} />
              <Route path="repositories" element={<RepositoriesPage />} />
              <Route path="repositories/:repositoryId" element={<RepositoryOverviewPage />} />
              <Route path="explorer/:repositoryId" element={<RepositoryExplorerPage />} />
              <Route path="chat" element={<ChatPage />} />

              {/* Workspaces, Pull Requests, History, Settings */}
              <Route path="workspaces" element={<WorkspacePage />} />
              <Route path="workspaces/:workspaceId" element={<WorkspacePage />} />
              <Route path="pull-requests" element={<PullRequestsPage />} />
              <Route path="history" element={<HistoryPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}