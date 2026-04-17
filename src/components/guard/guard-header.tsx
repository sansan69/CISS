"use client";

import React from "react";
import Image from "next/image";

interface GuardHeaderProps {
  employeeName: string;
}

export function GuardHeader({ employeeName }: GuardHeaderProps) {
  return (
    <header
      className="sticky top-0 z-40 flex items-center justify-between px-4 shrink-0"
      style={{
        background: "linear-gradient(135deg, #014c85 0%, #013a66 100%)",
        minHeight: 56,
        paddingTop: "max(env(safe-area-inset-top, 0px), 0px)",
        boxShadow: "0 1px 0 rgba(255,255,255,0.06), 0 4px 16px rgba(0,0,0,0.2)",
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div
          className="flex items-center justify-center h-8 w-8 rounded-xl shrink-0"
          style={{
            backgroundColor: "rgba(255,255,255,0.12)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18)",
          }}
        >
          <Image
            src="/ciss-logo.png"
            alt="CISS"
            width={22}
            height={22}
            className="h-auto w-auto"
            unoptimized
          />
        </div>
        <div>
          <p className="text-white font-bold text-sm leading-tight tracking-wide font-exo2">
            CISS
          </p>
          <p className="text-[9px] font-medium leading-tight uppercase tracking-widest"
             style={{ color: "#bd9c55" }}>
            Guard Portal
          </p>
        </div>
      </div>

      {/* Employee name */}
      <div className="min-w-0 flex-1 text-right ml-4">
        <p className="text-white text-sm font-semibold truncate leading-tight">
          {employeeName || "Guard Portal"}
        </p>
      </div>
    </header>
  );
}
