import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

/** 16px native checkbox tinted navy (Foundations "Inputs"). */
export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Checkbox({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        type="checkbox"
        className={cn("m-0 h-4 w-4 shrink-0 cursor-pointer accent-navy disabled:cursor-not-allowed", className)}
        {...rest}
      />
    );
  },
);
