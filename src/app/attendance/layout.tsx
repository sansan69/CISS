
import type { ReactNode } from 'react';
import { Toaster } from "@/components/ui/toaster"
import '@/app/globals.css'; 
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Home } from 'lucide-react';

// This is a simple layout for the public attendance page.
export default function AttendanceLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="p-4 border-b">
         <Button variant="outline" size="sm" asChild>
          <Link href="/">
            <Home className="mr-2 h-4 w-4" /> Back to Home
          </Link>
        </Button>
      </header>
      <main className="bg-background text-foreground">
        {children}
      </main>
      <Toaster />
    </>
  );
}
