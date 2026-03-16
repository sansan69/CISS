import Link from "next/link";
import { HomeIcon, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center gap-6 p-8 bg-gray-50 dark:bg-gray-900">
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
