
import type { ReactNode } from 'react';
import { AppLayout } from '@/components/layout/app-layout';
import { Toaster } from "@/components/ui/toaster"


export default function AuthenticatedAppLayout({ children }: { children: ReactNode }) {
  return (
    <AppLayout>
      {children}
      <Toaster />
    </AppLayout>
  );
}
