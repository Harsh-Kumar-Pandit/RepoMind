import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/Card.jsx";
import Button from "../components/ui/Button.jsx";
import { FolderGit2, Code2, MessageSquare, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";

export function DashboardPlaceholder() {
  const { user } = useAuth();

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#202124]">
          Welcome back, {user?.name || user?.login}
        </h1>
        <p className="text-xs text-[#5F6368] mt-1">
          RepoMind developer dashboard foundation. Select a section to explore.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <div className="w-8 h-8 rounded bg-[#6D5CE8]/10 text-[#6D5CE8] flex items-center justify-center mb-2">
              <FolderGit2 className="w-4 h-4" />
            </div>
            <CardTitle>Repositories</CardTitle>
            <CardDescription>
              Analyze new repositories and inspect indexing status.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/app/repositories">
              <Button variant="secondary" size="sm" className="w-full justify-between">
                <span>View Repos</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="w-8 h-8 rounded bg-[#25845B]/10 text-[#25845B] flex items-center justify-center mb-2">
              <Code2 className="w-4 h-4" />
            </div>
            <CardTitle>Workspaces</CardTitle>
            <CardDescription>
              Manual file editing, checkpoints and diff reviews.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/app/workspaces">
              <Button variant="secondary" size="sm" className="w-full justify-between">
                <span>Open Workspaces</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="w-8 h-8 rounded bg-[#17191D]/10 text-[#202124] flex items-center justify-center mb-2">
              <MessageSquare className="w-4 h-4" />
            </div>
            <CardTitle>AI Explanation</CardTitle>
            <CardDescription>
              Grounded answers with exact line and file citations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/app/chat">
              <Button variant="secondary" size="sm" className="w-full justify-between">
                <span>Start Chat</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function SectionPlaceholder({ title, description, icon: Icon }) {
  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-[#202124] flex items-center gap-2">
          {Icon && <Icon className="w-5 h-5 text-[#6D5CE8]" />}
          <span>{title}</span>
        </h1>
        <p className="text-xs text-[#5F6368] mt-1">{description}</p>
      </div>

      <div className="p-8 border border-dashed border-[#E5E5E2] rounded-md bg-white text-center">
        <p className="text-xs text-[#5F6368]">
          Foundation ready. Full feature module scheduled for subsequent attempts.
        </p>
      </div>
    </div>
  );
}
