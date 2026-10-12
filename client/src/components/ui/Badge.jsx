import { forwardRef } from "react";
import { cn } from "../../lib/utils.js";

export const Badge = forwardRef(function Badge(
  { className, variant = "default", children, ...props },
  ref
) {
  const variants = {
    default: "bg-[#F3F3F0] text-[#202124] border border-[#E5E5E2]",
    success: "bg-[#25845B]/10 text-[#25845B] border border-[#25845B]/20",
    danger: "bg-[#C84C4C]/10 text-[#C84C4C] border border-[#C84C4C]/20",
    violet: "bg-[#6D5CE8]/10 text-[#6D5CE8] border border-[#6D5CE8]/20",
    warning: "bg-[#D97706]/10 text-[#D97706] border border-[#D97706]/20",
  };

  return (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 text-xs font-mono font-medium",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
});

export default Badge;
