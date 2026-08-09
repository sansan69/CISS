"use client";

import type { ReactNode } from "react";

export function PageTransition({
  children,
  routeKey,
}: {
  children: ReactNode;
  routeKey: string;
}) {
  return (
    <div
      key={routeKey}
      className="mx-auto w-full max-w-[1600px] animate-fade-in"
    >
      {children}
    </div>
  );
}
