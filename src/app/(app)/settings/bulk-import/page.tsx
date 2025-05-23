
"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FileUp, Download, AlertCircle, CheckCircle, Loader2, FileText } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import axios from 'axios';

// IMPORTANT: Replace this with your actual deployed Cloud Function URL
const CLOUD_FUNCTION_URL = 'YOUR_CLOUD_FUNCTION_URL_HERE/processEmployeeCSV'; // Example: 'https://us-central1-your-project-id.cloudfunctions.net/processEmployeeCSV'

export default function BulkImportPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string>('Select a CSV file to begin.');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const { toast } = useToast();

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setUploadProgress(0);
    setErrorMessage(null);
    setSuccessMessage(null);
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
    if (CLOUD_FUNCTION_URL.startsWith('YOUR_CLOUD_FUNCTION_URL_HERE')) {
        toast({
          variant: "destructive",
          title: "Configuration Error",
          description: "Cloud Function URL is not configured in the frontend. Please update it.",
          duration: 7000,
        });
        setErrorMessage("Frontend configuration error: Cloud Function URL is not set. Admin needs to deploy the backend function and update this page.");
        return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setErrorMessage(null);
    setSuccessMessage(null);
    setStatusMessage('Preparing upload...');

    const formData = new FormData();
    formData.append('csvFile', selectedFile); // The Cloud Function will look for 'csvFile'

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

      setStatusMessage('Processing data, please wait...'); // Cloud function handles processing
      
      if (response.data.success) {
        setSuccessMessage(response.data.message || `Import successful! ${response.data.recordsProcessed || 'Some'} records processed.`);
        toast({ title: "Import Complete", description: response.data.message, duration: 7000 });
        setSelectedFile(null); // Clear selection on success
        setStatusMessage('Import completed successfully.');
      } else {
        // Use the message from the Cloud Function's error response
        throw new Error(response.data.message || "Unknown error during processing by the Cloud Function.");
      }
    } catch (error: any) {
      console.error("Upload or processing error:", error);
      let specificError = "An unexpected error occurred.";
      if (error.response) {
        // Error from Cloud Function (e.g., 400, 500 status with JSON body)
        specificError = error.response.data?.message || error.response.statusText || `Server error: ${error.response.status}`;
      } else if (error.request) {
        // Request was made but no response received (network issue, Cloud Function not reachable)
        specificError = "No response from server. Check network connection or Cloud Function status and URL.";
      } else {
        // Error setting up the request
        specificError = error.message || "Error setting up the request.";
      }
      setErrorMessage(`Import failed: ${specificError}`);
      toast({ variant: "destructive", title: "Import Failed", description: specificError, duration: 9000 });
      setStatusMessage('Import failed. See error message.');
    } finally {
      setIsUploading(false);
      // setUploadProgress(100); // Show full progress even on error for visual completeness of upload attempt
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
            <li>Essential headers: <code>FirstName</code>, <code>LastName</code>, <code>PhoneNumber</code>, <code>EmailAddress</code>, <code>ClientName</code>, <code>JoiningDate (YYYY-MM-DD)</code>, <code>DateOfBirth (YYYY-MM-DD)</code>, <code>Gender</code>, <code>FatherName</code>, <code>MotherName</code>, <code>MaritalStatus</code>, <code>District</code>, <code>IDProofType</code>, <code>IDProofNumber</code>, <code>BankAccountNumber</code>, <code>IFSCCode</code>, <code>BankName</code>, <code>FullAddress</code>. (Optional: <code>SpouseName</code>, <code>PANNumber</code>, <code>EPFUANNumber</code>, <code>ESICNumber</code>, <code>ResourceIDNumber</code>, <code>PhotoBlob</code>, <code>Status</code>, <code>IDProofDocumentURL</code>, <code>BankPassbookStatementURL</code>)</li>
            <li><code>PhotoBlob</code> column (optional): Should contain Data URIs for images (e.g., <code>data:image/jpeg;base64,...</code>).</li>
            <li>Supported file format: .csv.</li>
            <li>Maximum file size: 200MB (Cloud Function and server limits apply).</li>
            <li>Processing large files can take several minutes. Please be patient.</li>
          </ul>
          <Button variant="link" className="p-0 h-auto mt-2" asChild>
            {/* You'll need to create this template and place it in public/templates/ */}
            <a href="/templates/employee_import_template.csv" download data-ai-hint="download template">
              <Download className="mr-2 h-4 w-4" /> Download CSV Template
            </a>
          </Button>
        </AlertDescription>
      </Alert>

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

          {errorMessage && (
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
                {uploadProgress < 100 ? 'Uploading...' : 'Processing...'}
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
            {/* Placeholder for import history table */}
        </CardContent>
      </Card>
    </div>
  );
}
