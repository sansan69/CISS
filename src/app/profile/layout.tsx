
import type { ReactNode } from 'react';
import { Toaster } from "@/components/ui/toaster"
import '@/app/globals.css'; 

// This is a simple layout for public-facing pages like the profile view.
// It doesn't include the admin sidebar.
export default function PublicProfileLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <main className="bg-background text-foreground p-4 md:p-8">
        {children}
      </main>
      <Toaster />
    </>
  );
}
