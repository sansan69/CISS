"use client";

import Link from "next/link";
import { House as HomeIcon, Warning as AlertTriangle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] w-full flex-col items-center justify-center gap-6 bg-background p-8">
      <div className="flex flex-col items-center gap-4 max-w-md text-center">
        <AlertTriangle className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-50">404</h1>
        <p className="text-lg text-muted-foreground">This page could not be found.</p>
        <Button asChild className="mt-2">
          <Link href="/">
            <HomeIcon className="mr-2 h-4 w-4" />
            Back to Home
          </Link>
        </Button>
      </div>
    </div>
  );
}
