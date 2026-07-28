"use client";

import React from "react";
import Image from "next/image";

interface GuardHeaderProps {
  employeeName: string;
}

export function GuardHeader({ employeeName }: GuardHeaderProps) {
  return (
    <header
      className="sticky top-0 z-40 flex shrink-0 items-center gap-3 border-b border-border/70 bg-card/92 px-4 backdrop-blur-xl"
      style={{
        minHeight: 56,
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}
    >
      {/* Logo */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/15">
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
        <p className="truncate font-exo2 text-sm font-bold leading-tight tracking-tight text-foreground">
          CISS Guard
        </p>
      </div>

      {/* Employee name chip */}
      {employeeName && employeeName !== "Guard Portal" && (
        <div className="shrink-0 max-w-[140px]">
          <p className="truncate text-right text-xs font-bold leading-tight text-muted-foreground">
            {employeeName}
          </p>
        </div>
      )}
    </header>
  );
}
