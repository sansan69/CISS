
"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FileUp, Download, AlertCircle, CheckCircle, Loader2, FileText, Info } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import axios from 'axios';

// =====================================================================================
// IMPORTANT: ACTION REQUIRED FOR BULK IMPORT TO WORK
//
// The administrator MUST deploy the `processEmployeeCSV` Firebase Cloud Function
// and then replace the placeholder URL below with the actual deployed function URL.
//
// Example after deployment:
// const CLOUD_FUNCTION_URL = 'https://us-central1-your-project-id.cloudfunctions.net/processEmployeeCSV';
//
// =====================================================================================
const CLOUD_FUNCTION_URL = '!!!_MUST_BE_REPLACED_WITH_DEPLOYED_FUNCTION_URL_!!!/processEmployeeCSV';

export default function BulkImportPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string>('Select a CSV file to begin.');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showConfigWarning, setShowConfigWarning] = useState(false);
  const { toast } = useToast();

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setUploadProgress(0);
    setErrorMessage(null);
    setSuccessMessage(null);
    setShowConfigWarning(false);
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      if (file.type === "text/csv") {
        setSelectedFile(file);
        setStatusMessage(`Selected file: ${file.name}`);
      } else {
        toast({
          variant: "destructive",
          title: "Invalid File Type",
          description: "Please upload a CSV file (.csv).",
        });
        setSelectedFile(null);
        setStatusMessage('Invalid file type. Please select a CSV file.');
      }
    } else {
      setSelectedFile(null);
      setStatusMessage('No file selected.');
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      toast({ variant: "destructive", title: "No File Selected", description: "Please select a CSV file to upload." });
      return;
    }
    
    // Check if the placeholder URL is still in use
    if (CLOUD_FUNCTION_URL.includes('!!!_MUST_BE_REPLACED_WITH_DEPLOYED_FUNCTION_URL_!!!')) {
        toast({
          variant: "destructive",
          title: "Configuration Error",
          description: "Cloud Function URL is not configured. Please deploy the backend function and update the URL in this page's source code.",
          duration: 10000,
        });
        setErrorMessage("Frontend configuration error: Cloud Function URL is not set. Admin needs to deploy the backend function (processEmployeeCSV) and update the CLOUD_FUNCTION_URL constant in src/app/(app)/settings/bulk-import/page.tsx.");
        setShowConfigWarning(true);
        return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setErrorMessage(null);
    setSuccessMessage(null);
    setShowConfigWarning(false);
    setStatusMessage('Preparing upload...');

    const formData = new FormData();
    formData.append('csvFile', selectedFile); 

    try {
      setStatusMessage('Uploading file...');
      const response = await axios.post(CLOUD_FUNCTION_URL, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(percentCompleted);
            setStatusMessage(`Uploading ${percentCompleted}%...`);
          }
        },
      });

      // The Cloud Function might take time to process after upload is complete.
      // The frontend will show "Processing data..."
      // The actual success/failure comes from the Cloud Function's response after it finishes its own processing.
      setStatusMessage('Processing data, please wait. This can take several minutes for large files...'); 
      
      if (response.data.success) {
        setSuccessMessage(response.data.message || `Import successful! ${response.data.recordsProcessed || 'Some'} records processed.`);
        toast({ title: "Import Complete", description: response.data.message, duration: 7000 });
        setSelectedFile(null); 
        // Reset input field value so the same file can be re-selected if needed after an error
        const fileInput = document.getElementById('csv-file') as HTMLInputElement;
        if (fileInput) fileInput.value = "";
        setStatusMessage('Import completed successfully. Select another file or navigate away.');
      } else {
        // This case handles errors reported by the Cloud Function itself (e.g., processing errors)
        throw new Error(response.data.message || "Unknown error during processing by the Cloud Function.");
      }
    } catch (error: any) {
      console.error("Upload or processing error:", error);
      let specificError = "An unexpected error occurred.";
      if (error.response) {
        // Error from the HTTP request itself (e.g., 404, 500 from Cloud Function endpoint before JSON response)
        specificError = error.response.data?.message || error.response.statusText || `Server error: ${error.response.status}`;
      } else if (error.request) {
        // Request was made but no response received
        specificError = "No response from server. Check network connection or Cloud Function status and URL.";
      } else {
        // Error setting up the request or error thrown from the try block (e.g., from response.data.success being false)
        specificError = error.message || "Error setting up the request or processing response.";
      }
      setErrorMessage(`Import failed: ${specificError}`);
      toast({ variant: "destructive", title: "Import Failed", description: specificError, duration: 9000 });
      setStatusMessage('Import failed. See error message.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Import Employee Data from CSV</h1>
      
      <Alert>
        <FileText className="h-4 w-4" />
        <AlertTitle>Import Guidelines</AlertTitle>
        <AlertDescription>
          <ul className="list-disc list-inside space-y-1">
            <li>Ensure your CSV file follows the provided template format. The first row must be headers.</li>
            <li>Essential headers: <code>FirstName</code>, <code>LastName</code>, <code>PhoneNumber</code>, <code>ClientName</code>, <code>JoiningDate (YYYY-MM-DD)</code>. Many other fields are supported (see template).</li>
            <li><code>PhotoBlob</code> column (optional): Should contain Data URIs for images (e.g., <code>data:image/jpeg;base64,...</code>). Large images will be compressed by the backend.</li>
            <li>Supported file format: .csv. Max file size: ~200MB (Cloud Function and network limits apply).</li>
            <li>Processing large files can take several minutes. Please be patient after the upload completes.</li>
          </ul>
          <Button variant="link" className="p-0 h-auto mt-2" asChild>
            <a href="/templates/employee_import_template.csv" download data-ai-hint="download template">
              <Download className="mr-2 h-4 w-4" /> Download CSV Template
            </a>
          </Button>
        </AlertDescription>
      </Alert>

      {showConfigWarning && (
        <Alert variant="destructive" className="mt-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Action Required: Configuration Needed</AlertTitle>
          <AlertDescription>
            The Cloud Function URL for bulk import is not set up correctly in the frontend code. 
            An administrator needs to deploy the `processEmployeeCSV` Firebase Cloud Function and update the 
            `CLOUD_FUNCTION_URL` constant in the file: `src/app/(app)/settings/bulk-import/page.tsx`.
            The current placeholder is: <code>{CLOUD_FUNCTION_URL.split('/')[0]}</code>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Upload Employee CSV File</CardTitle>
          <CardDescription>Select a CSV file containing employee information to import into the system.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label htmlFor="csv-file" className="text-base font-medium">Choose CSV File</Label>
            <Input id="csv-file" type="file" accept=".csv" onChange={handleFileChange} className="mt-1" disabled={isUploading} />
          </div>

          <div className="space-y-2">
            <Label>Status</Label>
            <div className="p-3 border rounded-md bg-muted/30 min-h-[60px] flex flex-col justify-center">
              <p className="text-sm text-muted-foreground">{statusMessage}</p>
              {isUploading && uploadProgress < 100 && <Progress value={uploadProgress} className="w-full mt-2" />}
            </div>
          </div>
          
          {successMessage && (
            <Alert variant="default" className="bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-700">
              <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
              <AlertTitle className="text-green-700 dark:text-green-300">Import Successful</AlertTitle>
              <AlertDescription className="text-green-600 dark:text-green-400">
                {successMessage}
              </AlertDescription>
            </Alert>
          )}

          {errorMessage && !showConfigWarning && ( // Don't show generic error if config warning is already up
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Import Error</AlertTitle>
              <AlertDescription>
                {errorMessage}
                <p className="mt-2">Please check the file, console logs, or server logs (Cloud Function) and try again.</p>
              </AlertDescription>
            </Alert>
          )}

        </CardContent>
        <CardFooter>
          <Button onClick={handleUpload} disabled={!selectedFile || isUploading} className="w-full sm:w-auto">
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 
                {statusMessage.includes("Uploading") ? 'Uploading...' : 'Processing...'}
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
            <CardTitle>Import History (Placeholder)</CardTitle>
            <CardDescription>View logs of previous bulk import attempts.</CardDescription>
        </CardHeader>
        <CardContent>
            <p className="text-muted-foreground">No import history available yet. This section will show a table of past imports, their status, and any error reports.</p>
        </CardContent>
      </Card>
    </div>
  );
}
