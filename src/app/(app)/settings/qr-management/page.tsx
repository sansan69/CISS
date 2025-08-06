
"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { QrCode, AlertTriangle, CheckCircle, Users, RefreshCw, Loader2, ChevronLeft } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import Link from 'next/link';

export default function QrManagementPage() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStatus, setGenerationStatus] = useState<'idle' | 'generating' | 'success' | 'error'>('idle');
  const { toast } = useToast();

  const handleBulkRegenerate = async () => {
    setIsGenerating(true);
    setGenerationStatus('generating');
    setGenerationProgress(0);

    // Simulate bulk QR code regeneration
    const totalEmployees = 1234; // Example total employees
    let processedCount = 0;
    const interval = setInterval(() => {
      processedCount += Math.floor(totalEmployees / 20); // Process in chunks
      const progress = Math.min(100, Math.floor((processedCount / totalEmployees) * 100));
      setGenerationProgress(progress);

      if (progress >= 100) {
        clearInterval(interval);
        // Simulate success/failure
        setTimeout(() => {
          setIsGenerating(false);
          const success = Math.random() > 0.1; // 90% success rate
          if (success) {
            setGenerationStatus('success');
            toast({ title: "Bulk QR Regeneration Successful", description: `QR codes for ${totalEmployees} employees have been updated.` });
          } else {
            setGenerationStatus('error');
            toast({ variant: "destructive", title: "Bulk QR Regeneration Failed", description: "An error occurred during bulk QR code regeneration. Please try again." });
          }
        }, 500);
      }
    }, 100);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/settings">
            <ChevronLeft className="h-4 w-4" />
            <span className="sr-only">Back to Settings</span>
          </Link>
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">QR Code Management</h1>
      </div>
      
      <Alert variant="default">
        <QrCode className="h-4 w-4" />
        <AlertTitle>Important Notes on QR Codes</AlertTitle>
        <AlertDescription>
          <ul className="list-disc list-inside space-y-1">
            <li>QR codes are generated for each active employee.</li>
            <li>Filenames for QR codes are based on the employee's registered mobile number (e.g., <code>9876543210.png</code>).</li>
            <li>Regenerating QR codes will replace existing files. Ensure this is intended.</li>
            <li>QR codes link to employee profiles or attendance marking systems.</li>
          </ul>
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Bulk QR Code Regeneration</CardTitle>
          <CardDescription>Regenerate QR codes for all active employees. This process may take some time depending on the number of employees.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-5 w-5" />
            <span>Total Active Employees: 1,234 (example)</span>
          </div>
          
          {isGenerating && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Generation Progress:</p>
              <Progress value={generationProgress} className="w-full" />
              <p className="text-sm text-muted-foreground text-center">{generationProgress}% complete</p>
            </div>
          )}

          {generationStatus === 'success' && (
            <Alert variant="default" className="bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-700">
              <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
              <AlertTitle className="text-green-700 dark:text-green-300">Generation Successful</AlertTitle>
              <AlertDescription className="text-green-600 dark:text-green-400">
                All QR codes have been successfully regenerated and updated.
              </AlertDescription>
            </Alert>
          )}

          {generationStatus === 'error' && (
             <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Generation Failed</AlertTitle>
              <AlertDescription>
                An unexpected error occurred while regenerating QR codes. Please check system logs or try again later.
              </AlertDescription>
            </Alert>
          )}

        </CardContent>
        <CardFooter>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={isGenerating} className="w-full sm:w-auto">
                {isGenerating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Regenerating...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" /> Regenerate All QR Codes
                  </>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm Bulk Regeneration</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to regenerate QR codes for all active employees? This action will replace existing QR code files and cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleBulkRegenerate}>Confirm & Regenerate</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
            <CardTitle>Individual QR Code Management</CardTitle>
            <CardDescription>Search for an employee to view or regenerate their individual QR code. This is typically done via the employee's profile page.</CardDescription>
        </CardHeader>
        <CardContent>
            <p className="text-muted-foreground">
                To manage an individual employee's QR code, please navigate to their profile in the <Button variant="link" asChild className="p-0 h-auto"><a href="/employees">Employee Directory</a></Button>.
            </p>
        </CardContent>
      </Card>
    </div>
  );
}
