
"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FileUp, Download, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';

export default function BulkImportPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [errorMessages, setErrorMessages] = useState<string[]>([]);
  const [successMessage, setSuccessMessage] = useState<string>('');
  const { toast } = useToast();

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      if (file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || file.type === "application/vnd.ms-excel") {
        setSelectedFile(file);
        setUploadStatus('idle');
        setErrorMessages([]);
        setSuccessMessage('');
      } else {
        toast({
          variant: "destructive",
          title: "Invalid File Type",
          description: "Please upload an Excel file (.xlsx or .xls).",
        });
        setSelectedFile(null);
      }
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      toast({ variant: "destructive", title: "No File Selected", description: "Please select an Excel file to upload." });
      return;
    }

    setIsUploading(true);
    setUploadStatus('uploading');
    setUploadProgress(0);
    setErrorMessages([]);
    setSuccessMessage('');

    // Simulate upload progress
    let progress = 0;
    const interval = setInterval(() => {
      progress += 10;
      setUploadProgress(progress);
      if (progress >= 100) {
        clearInterval(interval);
        // Simulate backend processing
        setTimeout(() => {
          setIsUploading(false);
          // Simulate success/failure based on file name or random
          if (selectedFile.name.includes("error")) {
            setUploadStatus('error');
            setErrorMessages(["Row 5: Invalid mobile number format.", "Row 12: Missing required field 'Aadhar Number'."]);
            toast({ variant: "destructive", title: "Import Failed", description: "Found errors in the uploaded file."});
          } else {
            setUploadStatus('success');
            setSuccessMessage(`Successfully imported ${Math.floor(50 + Math.random() * 100)} employee records.`);
            toast({ title: "Import Successful", description: "Employee data imported successfully."});
            setSelectedFile(null); // Clear selection on success
          }
        }, 1000);
      }
    }, 200);
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Bulk Data Import</h1>
      
      <Alert>
        <FileUp className="h-4 w-4" />
        <AlertTitle>Import Guidelines</AlertTitle>
        <AlertDescription>
          <ul className="list-disc list-inside space-y-1">
            <li>Ensure your Excel file follows the provided template format.</li>
            <li>Supported formats: .xlsx, .xls.</li>
            <li>Maximum file size: 10MB.</li>
            <li>Data will be validated against backend schema. Any errors will be reported.</li>
          </ul>
          <Button variant="link" className="p-0 h-auto mt-2" asChild>
            <a href="/path-to-excel-template.xlsx" download data-ai-hint="download template">
              <Download className="mr-2 h-4 w-4" /> Download Excel Template
            </a>
          </Button>
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Upload Employee Data</CardTitle>
          <CardDescription>Select an Excel file containing employee information to import into the system.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="excel-file" className="text-base font-medium">Choose Excel File</Label>
            <Input id="excel-file" type="file" accept=".xlsx, .xls" onChange={handleFileChange} className="mt-1" disabled={isUploading} />
            {selectedFile && <p className="text-sm text-muted-foreground mt-2">Selected file: {selectedFile.name}</p>}
          </div>

          {isUploading && (
            <div className="space-y-2">
              <Label>Upload Progress</Label>
              <Progress value={uploadProgress} className="w-full" />
              <p className="text-sm text-muted-foreground text-center">{uploadProgress}%</p>
            </div>
          )}

          {uploadStatus === 'success' && successMessage && (
            <Alert variant="default" className="bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-700">
              <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
              <AlertTitle className="text-green-700 dark:text-green-300">Import Successful</AlertTitle>
              <AlertDescription className="text-green-600 dark:text-green-400">
                {successMessage}
              </AlertDescription>
            </Alert>
          )}

          {uploadStatus === 'error' && errorMessages.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Import Errors</AlertTitle>
              <AlertDescription>
                <p>The following errors were found in the uploaded file:</p>
                <ul className="list-disc list-inside mt-2 text-sm">
                  {errorMessages.map((err, index) => (
                    <li key={index}>{err}</li>
                  ))}
                </ul>
                <p className="mt-2">Please correct these errors and try uploading again.</p>
              </AlertDescription>
            </Alert>
          )}

        </CardContent>
        <CardFooter>
          <Button onClick={handleUpload} disabled={!selectedFile || isUploading} className="w-full sm:w-auto">
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading...
              </>
            ) : (
              <>
                <FileUp className="mr-2 h-4 w-4" /> Upload and Process File
              </>
            )}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
            <CardTitle>Import History</CardTitle>
            <CardDescription>View logs of previous bulk import attempts.</CardDescription>
        </CardHeader>
        <CardContent>
            <p className="text-muted-foreground">No import history available yet. This section will show a table of past imports, their status, and any error reports.</p>
            {/* Placeholder for import history table */}
        </CardContent>
      </Card>
    </div>
  );
}
