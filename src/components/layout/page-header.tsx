"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, CaretRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Small all-caps label rendered above the title (eyebrow text) */
  eyebrow?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: ReactNode;
  className?: string;
  /** Add a restrained gold brand marker beside the heading */
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
  eyebrow,
  breadcrumbs,
  actions,
  className,
  accent = false,
  backHref,
}: PageHeaderProps) {
  const router = useRouter();

  return (
    <header
      className={cn(
        "mb-6 border-b border-border/80 pb-5 animate-slide-down sm:mb-7 sm:pb-6",
        className,
      )}
    >
      {/* Eyebrow */}
      {eyebrow && (
        <p className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-primary">
          {eyebrow}
        </p>
      )}

      {/* Breadcrumbs — desktop only; mobile header handles current-page context */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav
          aria-label="Breadcrumb"
          className="mb-3 hidden flex-wrap items-center gap-1.5 text-xs leading-none text-muted-foreground sm:flex"
        >
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <CaretRight className="h-3 w-3 shrink-0 text-muted-foreground/55" weight="bold" />}
              {crumb.href && i < breadcrumbs.length - 1 ? (
                <Link
                  href={crumb.href}
                  className="font-bold transition-colors hover:text-primary"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={cn(
                    i === breadcrumbs.length - 1 && "font-bold text-foreground"
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
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="flex min-w-0 items-start gap-3">
          {/* Back button — desktop only; mobile relies on OS swipe-back gesture */}
          {backHref && (
            <button
              onClick={() => backHref === "__back" ? router.back() : router.push(backHref)}
              className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-[transform,background-color,color] duration-200 ease-spring hover:bg-muted hover:text-foreground active:scale-[0.98] sm:flex"
              aria-label="Go back"
            >
              <ArrowLeft className="h-4 w-4" weight="bold" />
            </button>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1
                className="font-exo2 text-2xl font-bold leading-tight tracking-[-0.035em] text-foreground sm:text-[2rem]"
              >
                {title}
              </h1>
              {accent && (
                <span className="h-1.5 w-8 rounded-full bg-accent" aria-hidden="true" />
              )}
            </div>

            {description && (
              <p className="mt-1.5 max-w-[65ch] text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        {actions && (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
