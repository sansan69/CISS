"use client";

import { ShieldCheck } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * Composed branded loading state — used in place of bare centered spinners
 * across (app) pages. Renders a brand icon bubble, shimmer bars, and a label
 * so loading never reads as a frozen screen.
 */
export function PageLoading({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-40 flex-col items-center justify-center gap-3",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="relative">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
          <ShieldCheck className="h-6 w-6 text-primary" weight="duotone" />
        </div>
        <span
          className="absolute -inset-1 animate-ping rounded-3xl bg-primary/10"
          aria-hidden
        />
      </div>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <div className="w-44 space-y-1.5" aria-hidden>
        <div className="h-2 rounded-full animate-shimmer" />
        <div className="h-2 w-3/4 rounded-full animate-shimmer" />
      </div>
    </div>
  );
}
