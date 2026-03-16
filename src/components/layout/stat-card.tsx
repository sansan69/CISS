import type { ElementType } from "react";
import { Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface StatCardProps {
  title: string;
  value?: number | string;
  icon: ElementType;
  isLoading?: boolean;
  error?: string | null;
  helpText?: string;
  trendLabel?: string;
  trendDirection?: "up" | "down" | "neutral";
}

export function StatCard({
  title,
  value,
  icon: Icon,
  isLoading = false,
  error,
  helpText,
  trendLabel,
  trendDirection = "neutral",
}: StatCardProps) {
  const TrendIcon =
    trendDirection === "up" ? TrendingUp : trendDirection === "down" ? TrendingDown : null;

  return (
    <Card className="border-border/80 bg-card/95 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
          {trendLabel ? (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              {TrendIcon ? <TrendIcon className="h-3.5 w-3.5" /> : null}
              <span>{trendLabel}</span>
            </div>
          ) : null}
        </div>
        <div className="rounded-full bg-primary/10 p-2 text-primary">
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {isLoading ? (
          <div className="flex h-9 items-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">Error loading</p>
        ) : (
          <>
            <div className="text-2xl font-semibold tracking-tight text-foreground">
              {typeof value === "number" ? value.toLocaleString() : value ?? "N/A"}
            </div>
            {helpText ? <p className="text-xs text-muted-foreground">{helpText}</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default StatCard;
