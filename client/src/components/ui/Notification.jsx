import { cn } from "../../lib/utils.js";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

export function Notification({
  type = "info",
  title,
  message,
  onClose,
  className,
}) {
  const configs = {
    info: {
      border: "border-[#E5E5E2]",
      bg: "bg-white",
      icon: <Info className="w-4 h-4 text-[#6D5CE8]" />,
    },
    success: {
      border: "border-[#25845B]/30",
      bg: "bg-[#25845B]/5",
      icon: <CheckCircle2 className="w-4 h-4 text-[#25845B]" />,
    },
    error: {
      border: "border-[#C84C4C]/30",
      bg: "bg-[#C84C4C]/5",
      icon: <AlertCircle className="w-4 h-4 text-[#C84C4C]" />,
    },
  };

  const current = configs[type] || configs.info;

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md border p-3.5 shadow-xs transition-all",
        current.border,
        current.bg,
        className
      )}
      role="alert"
    >
      <div className="shrink-0 mt-0.5">{current.icon}</div>
      <div className="flex-1 min-w-0">
        {title && <h4 className="text-xs font-semibold text-[#202124]">{title}</h4>}
        {message && <p className="text-xs text-[#5F6368] mt-0.5">{message}</p>}
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="shrink-0 text-[#80868B] hover:text-[#202124] p-0.5"
          aria-label="Close alert"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

export default Notification;
