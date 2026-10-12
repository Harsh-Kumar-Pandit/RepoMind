export function LoadingSkeleton({ className = "h-4 w-full" }) {
  return (
    <div
      className={`animate-pulse bg-[#E5E5E2] rounded ${className}`}
      aria-hidden="true"
    />
  );
}

export function LoadingSpinner({ size = "md", label = "Loading..." }) {
  const sizeMap = {
    sm: "w-4 h-4",
    md: "w-6 h-6",
    lg: "w-8 h-8",
  };

  return (
    <div className="flex flex-col items-center justify-center p-8 gap-3" role="status">
      <svg
        className={`animate-spin text-[#6D5CE8] ${sizeMap[size] || sizeMap.md}`}
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
          strokeWidth="3"
        ></circle>
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8v8H4z"
        ></path>
      </svg>
      {label && <span className="text-xs text-[#5F6368] font-medium">{label}</span>}
    </div>
  );
}

export default LoadingSpinner;
