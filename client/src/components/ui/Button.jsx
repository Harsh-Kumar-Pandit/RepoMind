import { forwardRef } from "react";
import { cn } from "../../lib/utils.js";

export const Button = forwardRef(function Button(
  {
    className,
    variant = "default",
    size = "default",
    disabled = false,
    loading = false,
    children,
    type = "button",
    ...props
  },
  ref
) {
  const baseStyles =
    "inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D5CE8] focus-visible:ring-offset-1 disabled:opacity-50 disabled:pointer-events-none rounded cursor-pointer select-none";

  const variants = {
    default: "bg-[#6D5CE8] text-white hover:bg-[#5B4BC4] shadow-sm",
    secondary: "bg-[#FFFFFF] text-[#202124] border border-[#E5E5E2] hover:bg-[#F3F3F0] hover:border-[#D1D1CD] shadow-sm",
    ghost: "text-[#202124] hover:bg-[#E5E5E2]/50",
    destructive: "bg-[#C84C4C] text-white hover:bg-[#B33D3D] shadow-sm",
    outline: "bg-transparent text-[#202124] border border-[#E5E5E2] hover:bg-[#F8F8F6]",
    sidebar: "w-full justify-start text-[#D1D5DB] hover:text-white hover:bg-[#2A2E35] rounded-md px-3 py-2 text-sm",
    sidebarActive: "w-full justify-start text-white bg-[#2A2E35] font-semibold rounded-md px-3 py-2 text-sm",
  };

  const sizes = {
    default: "h-9 px-4 py-2 text-sm",
    sm: "h-8 px-3 text-xs",
    lg: "h-10 px-5 text-base",
    icon: "h-9 w-9 p-0",
  };

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(baseStyles, variants[variant], sizes[size], className)}
      {...props}
    >
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <svg
            className="animate-spin h-4 w-4 text-current"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8H4z"
            ></path>
          </svg>
          <span>Loading...</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
});

export default Button;
