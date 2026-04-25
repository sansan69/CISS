"use client";

import React from "react";
import Image from "next/image";

interface GuardHeaderProps {
  employeeName: string;
}

export function GuardHeader({ employeeName }: GuardHeaderProps) {
  return (
    <header
      className="sticky top-0 z-40 flex items-center gap-3 bg-card/97 backdrop-blur-xl border-b border-border/70 px-4 shrink-0"
      style={{
        minHeight: 56,
        paddingTop: "env(safe-area-inset-top, 0px)",
        boxShadow: "0 1px 0 hsl(var(--border) / 0.5), 0 2px 8px hsl(0 0% 0% / 0.04)",
      }}
    >
      {/* Logo */}
      <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-brand-blue-pale shrink-0">
        <Image
          src="/ciss-logo.png"
          alt="CISS"
          width={18}
          height={18}
          className="h-auto w-auto"
          unoptimized
        />
      </div>

      {/* Identity */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate font-exo2 tracking-tight leading-tight">
          Guard Portal
        </p>
      </div>

      {/* Employee name chip */}
      {employeeName && employeeName !== "Guard Portal" && (
        <div className="shrink-0 max-w-[140px]">
          <p className="text-xs font-medium text-muted-foreground truncate text-right leading-tight">
            {employeeName}
          </p>
        </div>
      )}
    </header>
  );
}
