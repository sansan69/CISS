import * as React from "react";
import { TrendingUp, TrendingDown, Minus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

export type TrendDirection = "up" | "down" | "flat";

interface StatCardProps {
  title: string;
  value?: number | string;
  /** Small subtitle shown below the value */
  subtitle?: string;
  /** Icon component (LucideIcon) */
  icon: React.ElementType;
  /** Tailwind bg class for the icon bubble, e.g. "bg-blue-100 text-blue-600" */
  iconColor?: string;
  /** Whether the card is in a loading state */
  isLoading?: boolean;
  /** Error message if fetch failed */
  error?: string | null;
  /** Trend vs. previous period */
  trend?: TrendDirection;
  trendValue?: string; // e.g. "+12%" or "−3"
  /** Click handler (makes card interactive) */
  onClick?: () => void;
  className?: string;
  /** Animation delay class for stagger */
  delayClass?: string;
}

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = "bg-brand-blue-pale text-brand-blue",
  isLoading = false,
  error = null,
  trend,
  trendValue,
  onClick,
  className,
  delayClass,
}: StatCardProps) {
  const trendColor =
    trend === "up"   ? "text-green-600"  :
    trend === "down" ? "text-red-500"    :
                       "text-muted-foreground";

  const TrendIcon =
    trend === "up"   ? TrendingUp  :
    trend === "down" ? TrendingDown :
                       Minus;

  return (
    <Card
      variant={onClick ? "interactive" : "default"}
      onClick={onClick}
      className={cn(
        "animate-slide-up",
        delayClass,
        className
      )}
    >
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          {/* Icon bubble */}
          <div className={cn("stat-icon", iconColor)}>
            <Icon className="h-5 w-5" />
          </div>

          {/* Trend indicator */}
          {trend && trendValue && !isLoading && !error && (
            <div className={cn("flex items-center gap-1 text-xs font-semibold", trendColor)}>
              <TrendIcon className="h-3.5 w-3.5" />
              <span>{trendValue}</span>
            </div>
          )}
        </div>

        {/* Value */}
        <div className="mt-3">
          {isLoading ? (
            <div className="space-y-1.5">
              <div className="h-7 w-20 rounded-md animate-shimmer" />
              <div className="h-3.5 w-28 rounded animate-shimmer" />
            </div>
          ) : error ? (
            <p className="text-sm text-destructive font-medium">—</p>
          ) : (
            <>
              <p className="text-2xl sm:text-3xl font-bold text-foreground leading-none animate-count-up tabular-nums">
                {typeof value === "number" ? value.toLocaleString() : (value ?? "—")}
              </p>
              {subtitle && (
                <p className="text-xs text-muted-foreground mt-1 leading-tight">{subtitle}</p>
              )}
            </>
          )}
        </div>

        {/* Title */}
        <p className="mt-2 text-xs font-medium text-muted-foreground uppercase tracking-wide leading-none">
          {title}
        </p>
      </div>
    </Card>
  );
}
