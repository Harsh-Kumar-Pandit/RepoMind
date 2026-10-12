import { forwardRef } from "react";
import { cn } from "../../lib/utils.js";

export const Card = forwardRef(function Card({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-md border border-[#E5E5E2] bg-white text-[#202124] shadow-xs",
        className
      )}
      {...props}
    />
  );
});

export const CardHeader = forwardRef(function CardHeader({ className, ...props }, ref) {
  return <div ref={ref} className={cn("flex flex-col space-y-1.5 p-5", className)} {...props} />;
});

export const CardTitle = forwardRef(function CardTitle({ className, children, ...props }, ref) {
  return (
    <h3
      ref={ref}
      className={cn("text-base font-semibold leading-none tracking-tight text-[#202124]", className)}
      {...props}
    >
      {children}
    </h3>
  );
});

export const CardDescription = forwardRef(function CardDescription({ className, ...props }, ref) {
  return (
    <p ref={ref} className={cn("text-xs text-[#5F6368]", className)} {...props} />
  );
});

export const CardContent = forwardRef(function CardContent({ className, ...props }, ref) {
  return <div ref={ref} className={cn("p-5 pt-0", className)} {...props} />;
});

export const CardFooter = forwardRef(function CardFooter({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn("flex items-center p-5 pt-0 border-t border-[#E5E5E2]/60 mt-4", className)}
      {...props}
    />
  );
});

export default Card;
