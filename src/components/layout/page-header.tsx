"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: ReactNode;
  className?: string;
  /** Show a gold accent line below the title */
  accent?: boolean;
  /** Show a back button (goes back in history) — useful on detail pages */
  backHref?: string;
}

/**
 * Consistent page header used across all (app) pages.
 *
 * Usage:
 *   <PageHeader
 *     title="Employees"
 *     breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Employees" }]}
 *     actions={<Button>Add Employee</Button>}
 *     accent
 *   />
 */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  className,
  accent = false,
  backHref,
}: PageHeaderProps) {
  const router = useRouter();

  return (
    <div className={cn("mb-5 sm:mb-6 animate-slide-down", className)}>
      {/* Breadcrumbs */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1 text-[11px] text-muted-foreground mb-2 flex-wrap leading-none"
        >
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground/60" />}
              {crumb.href && i < breadcrumbs.length - 1 ? (
                <Link
                  href={crumb.href}
                  className="hover:text-primary transition-colors font-medium"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={cn(
                    i === breadcrumbs.length - 1 && "text-foreground font-semibold"
                  )}
                >
                  {crumb.label}
                </span>
              )}
            </span>
          ))}
        </nav>
      )}

      {/* Title row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {/* Back button */}
          {backHref && (
            <button
              onClick={() => backHref === "__back" ? router.back() : router.push(backHref)}
              className="flex items-center justify-center h-8 w-8 rounded-lg border border-border hover:bg-muted transition-colors shrink-0 mt-0.5"
              aria-label="Go back"
            >
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            </button>
          )}

          <div className="min-w-0">
            {/* Title with optional gold accent line */}
            <div className={cn("flex flex-col", accent && "relative")}>
              {accent && (
                <span
                  className="absolute -left-3 top-1/2 -translate-y-1/2 w-1 h-7 rounded-r-full bg-brand-gold"
                  aria-hidden
                />
              )}
              <h1
                className={cn(
                  "text-xl sm:text-2xl font-bold leading-tight truncate",
                  accent ? "text-foreground pl-0" : "text-foreground"
                )}
              >
                {title}
              </h1>
            </div>

            {description && (
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                {description}
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        {actions && (
          <div className="flex items-center gap-2 shrink-0 self-start mt-0.5">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
