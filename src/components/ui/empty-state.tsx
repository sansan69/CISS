import * as React from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: React.ElementType;
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
      {Icon && (
        <div
          className={cn(
            "mb-4 flex items-center justify-center rounded-2xl bg-primary/[0.07] text-primary",
            compact
              ? "h-10 w-10"
              : "h-14 w-14",
          )}
        >
          <Icon className={cn(compact ? "h-5 w-5" : "h-7 w-7")} />
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
