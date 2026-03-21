import type { ReactNode } from "react";

export default function GuardLoginLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900">
      {children}
    </div>
  );
}
