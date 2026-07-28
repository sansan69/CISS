
import type { ReactNode } from 'react';
import '@/app/globals.css';

// This is a simple layout for public-facing pages like the profile view.
// It doesn't include the admin sidebar.
export default function PublicProfileLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-[100dvh] bg-background p-4 text-foreground md:p-8">
      {children}
    </main>
  );
}
