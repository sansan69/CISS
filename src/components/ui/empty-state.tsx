import * as React from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: React.ElementType;
  /** Emoji or image URL (alternative to icon) */
  emoji?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  /** Compact variant for use inside table cells or smaller areas */
  compact?: boolean;
}

/**
 * Consistent empty state displayed when a list/table has no data.
 *
 * Usage:
 *   <EmptyState
 *     icon={Users}
 *     title="No employees found"
 *     description="Try adjusting your filters or add a new employee."
 *     action={<Button>Add Employee</Button>}
 *   />
 */
export function EmptyState({
  icon: Icon,
  emoji,
  title,
  description,
  action,
  className,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center animate-fade-in",
        compact ? "py-8 px-4" : "py-14 px-6",
        className
      )}
    >
      {/* Icon or emoji */}
      {(Icon || emoji) && (
        <div
          className={cn(
            "flex items-center justify-center rounded-lg mb-4 ring-1 ring-border/70",
            compact
              ? "h-10 w-10 bg-muted/70"
              : "h-14 w-14 bg-muted/70",
            Icon && "text-muted-foreground"
          )}
        >
          {emoji ? (
            <span className={cn(compact ? "text-2xl" : "text-3xl")}>{emoji}</span>
          ) : Icon ? (
            <Icon className={cn(compact ? "h-5 w-5" : "h-7 w-7")} />
          ) : null}
        </div>
      )}

      <p
        className={cn(
          "font-semibold text-foreground",
          compact ? "text-sm" : "text-base"
        )}
      >
        {title}
      </p>

      {description && (
        <p
          className={cn(
            "text-muted-foreground mt-1.5 max-w-xs",
            compact ? "text-xs" : "text-sm"
          )}
        >
          {description}
        </p>
      )}

      {action && (
        <div className={cn("flex gap-2 flex-wrap justify-center", compact ? "mt-3" : "mt-5")}>
          {action}
        </div>
      )}
    </div>
  );
}
