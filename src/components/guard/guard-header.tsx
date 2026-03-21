"use client";

import React from "react";

const BRAND_BLUE = "#014c85";
const BRAND_GOLD = "#bd9c55";

interface GuardHeaderProps {
  employeeName: string;
}

export function GuardHeader({ employeeName }: GuardHeaderProps) {
  return (
    <header
      className="sticky top-0 z-40 flex items-center justify-between px-4"
      style={{
        backgroundColor: BRAND_BLUE,
        height: 56,
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div
          className="flex items-center justify-center h-8 w-8 rounded-lg"
          style={{ backgroundColor: "rgba(255,255,255,0.15)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ciss-logo.png" alt="CISS" width={22} height={22} />
        </div>
        <span className="text-white font-bold text-sm tracking-wide">CISS</span>
      </div>

      {/* Employee info */}
      <div className="min-w-0 flex-1 text-right ml-4">
        <p className="text-white text-sm font-semibold truncate leading-tight">
          {employeeName || "Guard Portal"}
        </p>
        <p
          className="text-xs font-medium truncate leading-tight"
          style={{ color: BRAND_GOLD }}
        >
          Guard Portal
        </p>
      </div>
    </header>
  );
}
