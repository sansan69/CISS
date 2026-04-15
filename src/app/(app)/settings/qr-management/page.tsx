
"use client";

import React, { useState, useEffect } from 'react';
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
import { PageHeader } from '@/components/layout/page-header';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { generateQrCodeDataUrl } from '@/lib/qr';

export default function QrManagementPage() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStatus, setGenerationStatus] = useState<'idle' | 'generating' | 'success' | 'error'>('idle');
  const [totalEmployees, setTotalEmployees] = useState(0);
  const { toast } = useToast();

  useEffect(() => {
    const countActive = async () => {
      try {
        const snap = await getDocs(query(collection(db, 'employees'), where('status', '==', 'Active')));
        setTotalEmployees(snap.size);
      } catch {
        setTotalEmployees(0);
      }
    };
    countActive();
  }, []);

  const handleBulkRegenerate = async () => {
    setIsGenerating(true);
    setGenerationStatus('generating');
    setGenerationProgress(0);

    try {
      const snap = await getDocs(query(collection(db, 'employees'), where('status', '==', 'Active')));
      const total = snap.size;
      setTotalEmployees(total);

      if (total === 0) {
        setIsGenerating(false);
        setGenerationStatus('success');
        toast({ title: "No Active Employees", description: "There are no active employees to regenerate QR codes for." });
        return;
      }

      let processedCount = 0;
      let successCount = 0;
      let failCount = 0;
      const BATCH_SIZE = 500;
      let batch = writeBatch(db);
      let opsInBatch = 0;

      for (const docSnap of snap.docs) {
        try {
          const data = docSnap.data();
          const employeeId = data.employeeId || '';
          const fullName = data.fullName || '';
          const phoneNumber = data.phoneNumber || '';
          const qrCodeUrl = await generateQrCodeDataUrl(employeeId, fullName, phoneNumber);
          batch.update(doc(db, 'employees', docSnap.id), { qrCodeUrl, updatedAt: serverTimestamp() });
          opsInBatch++;
          successCount++;

          if (opsInBatch >= BATCH_SIZE) {
            await batch.commit();
            batch = writeBatch(db);
            opsInBatch = 0;
          }
        } catch {
          failCount++;
        }

        processedCount++;
        setGenerationProgress(Math.round((processedCount / total) * 100));
      }

      if (opsInBatch > 0) {
        await batch.commit();
      }

      setIsGenerating(false);
      if (failCount === 0) {
        setGenerationStatus('success');
        toast({ title: "Bulk QR Regeneration Successful", description: `QR codes for ${successCount} employees have been updated.` });
      } else {
        setGenerationStatus('success');
        toast({ title: "Bulk QR Regeneration Completed", description: `${successCount} succeeded, ${failCount} failed out of ${total} employees.` });
      }
    } catch (err) {
      console.error("Bulk QR regeneration failed:", err);
      setIsGenerating(false);
      setGenerationStatus('error');
      toast({ variant: "destructive", title: "Bulk QR Regeneration Failed", description: "An error occurred during bulk QR code regeneration. Please try again." });
    }
  };

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <PageHeader
        eyebrow="Admin"
        title="QR Code Management"
        description="Regenerate and maintain employee QR assets used in attendance and profile lookups."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Settings", href: "/settings" },
          { label: "QR Code Management" },
        ]}
        actions={
          <Button variant="outline" size="sm" asChild className="w-full sm:w-auto">
            <Link href="/settings">
              <ChevronLeft className="mr-2 h-4 w-4" />
              <span>Back to Settings</span>
            </Link>
          </Button>
        }
      />
      
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
            <span>Total Active Employees: {totalEmployees}</span>
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
