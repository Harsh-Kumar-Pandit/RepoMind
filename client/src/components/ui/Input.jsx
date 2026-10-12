import { forwardRef } from "react";
import { cn } from "../../lib/utils.js";

export const Input = forwardRef(function Input(
  { className, type = "text", error = false, ...props },
  ref
) {
  return (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded border bg-white px-3 py-1 text-sm text-[#202124] transition-colors",
        "placeholder:text-[#80868B]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D5CE8] focus-visible:border-transparent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        error ? "border-[#C84C4C] focus-visible:ring-[#C84C4C]" : "border-[#E5E5E2]",
        className
      )}
      {...props}
    />
  );
});

export default Input;
