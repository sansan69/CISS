import * as React from "react"
import { cn } from "@/lib/utils"

/* ─── InputProps ─────────────────────────────────────────────── */
export interface InputProps extends React.ComponentProps<"input"> {
  /** Icon rendered on the left inside the input */
  startIcon?: React.ReactNode
  /** Icon rendered on the right inside the input */
  endIcon?: React.ReactNode
}

/* ─── Input ──────────────────────────────────────────────────── */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, startIcon, endIcon, ...props }, ref) => {
    // When icons are present, wrap in a relative container
    if (startIcon || endIcon) {
      return (
        <div className="relative flex items-center w-full">
          {startIcon && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground [&_svg]:size-4 pointer-events-none">
              {startIcon}
            </span>
          )}
          <input
            type={type}
            className={cn(
              // Base
              "flex w-full rounded-lg border border-input bg-background",
              "text-sm text-foreground placeholder:text-muted-foreground",
              "ring-offset-background",
              // Sizing — 44px height on mobile, 40px on desktop (both ≥ touch target)
              "h-11 md:h-10 py-2",
              // Focus ring — brand blue
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1 focus-visible:border-primary/60",
              // File inputs
              "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
              // Disabled
              "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted",
              // iOS zoom prevention
              "[font-size:16px]",
              // Icon padding
              startIcon ? "pl-9" : "px-3",
              endIcon   ? "pr-9" : "",
              className
            )}
            ref={ref}
            {...props}
          />
          {endIcon && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground [&_svg]:size-4 pointer-events-none">
              {endIcon}
            </span>
          )}
        </div>
      )
    }

    return (
      <input
        type={type}
        className={cn(
          "flex h-11 md:h-10 w-full rounded-lg border border-input bg-background px-3 py-2",
          "text-sm text-foreground placeholder:text-muted-foreground",
          "ring-offset-background",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1 focus-visible:border-primary/60",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted",
          "transition-colors duration-150",
          "[font-size:16px]",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
