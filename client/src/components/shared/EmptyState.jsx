import Button from "../ui/Button.jsx";

export function EmptyState({
  icon: Icon,
  title = "No data found",
  description = "Get started by creating your first item.",
  actionText,
  onAction,
}) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-[#E5E5E2] rounded-md bg-[#F8F8F6]/60">
      {Icon && (
        <div className="w-10 h-10 rounded-full bg-[#E5E5E2]/50 flex items-center justify-center text-[#5F6368] mb-3">
          <Icon className="w-5 h-5" />
        </div>
      )}
      <h3 className="text-sm font-semibold text-[#202124]">{title}</h3>
      <p className="text-xs text-[#5F6368] mt-1 max-w-sm">{description}</p>
      {actionText && onAction && (
        <Button size="sm" onClick={onAction} className="mt-4">
          {actionText}
        </Button>
      )}
    </div>
  );
}

export default EmptyState;
