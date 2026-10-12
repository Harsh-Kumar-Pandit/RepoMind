import { AlertTriangle, RefreshCw } from "lucide-react";
import Button from "../ui/Button.jsx";

export function ErrorState({
  title = "Something went wrong",
  message = "An error occurred while loading this data.",
  onRetry,
}) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center border border-[#E5E5E2] rounded-md bg-white">
      <div className="w-10 h-10 rounded-full bg-[#C84C4C]/10 flex items-center justify-center text-[#C84C4C] mb-3">
        <AlertTriangle className="w-5 h-5" />
      </div>
      <h3 className="text-sm font-semibold text-[#202124]">{title}</h3>
      <p className="text-xs text-[#5F6368] mt-1 max-w-sm">{message}</p>
      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onRetry}
          className="mt-4 gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Try Again</span>
        </Button>
      )}
    </div>
  );
}

export default ErrorState;
