
import type { ReactNode } from 'react';
import { Toaster } from "@/components/ui/toaster";
import '@/app/globals.css'; // Ensure global styles are applied

export default function EnrollLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <main className="min-h-screen bg-background text-foreground">
        {children}
      </main>
      <Toaster />
    </>
  );
}
