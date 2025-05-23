
"use client";

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { type Employee } from '@/types/employee'; // Ensure new fields are in Employee type
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Edit3, User, Briefcase, Banknote, ShieldCheck, QrCode, FileUp, Download, Loader2, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { db } from '@/lib/firebase';
import { doc, getDoc, Timestamp } from 'firebase/firestore';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const DetailItem: React.FC<{ label: string; value?: string | number | null | Date; isDate?: boolean }> = ({ label, value, isDate }) => {
  let displayValue = 'N/A';
  if (value !== null && value !== undefined) {
    if (isDate && value instanceof Date) {
      displayValue = format(value, "PPP"); // Format: Jan 1, 2023
    } else if (isDate && typeof value === 'string') { // Handle ISO string dates from mock or Firestore
      try {
        displayValue = format(new Date(value), "PPP");
      } catch (e) {
        displayValue = String(value); // Fallback if date parsing fails
      }
    }
     else if (value instanceof Timestamp) { // Handle Firestore Timestamps
      displayValue = format(value.toDate(), "PPP");
    }
    else {
      displayValue = String(value);
    }
  }
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5">
      <span className="text-sm text-muted-foreground col-span-1">{label}</span>
      <span className="text-sm font-medium col-span-2">{displayValue}</span>
    </div>
  );
};


const DocumentItem: React.FC<{ name: string, url?: string, type: string }> = ({ name, url, type }) => (
    <div className="flex items-center justify-between p-3 border rounded-md">
        <div className="flex items-center gap-3">
            <FileUp className="h-5 w-5 text-primary" />
            <div>
                <p className="text-sm font-medium">{name}</p>
                <p className="text-xs text-muted-foreground">{type}</p>
            </div>
        </div>
        {url ? (
            <Button variant="outline" size="sm" asChild>
                <a href={url} target="_blank" rel="noopener noreferrer" data-ai-hint={`${type} document`}>
                    <Download className="mr-2 h-4 w-4" /> View/Download
                </a>
            </Button>
        ) : (
            <Badge variant="outline">Not Uploaded</Badge>
        )}
    </div>
);


export default function EmployeeProfilePage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const employeeIdFromUrl = params.id as string;

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = React.useState(false); // Placeholder for edit state

  useEffect(() => {
    if (!employeeIdFromUrl) {
      setError("Employee ID not found in URL.");
      setIsLoading(false);
      return;
    }

    const fetchEmployee = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const employeeDocRef = doc(db, "employees", employeeIdFromUrl);
        const employeeDocSnap = await getDoc(employeeDocRef);

        if (employeeDocSnap.exists()) {
          const data = employeeDocSnap.data();
          // Convert Firestore Timestamps to Date objects or keep as ISO strings if needed
          const formattedData: Employee = {
            ...data,
            id: employeeDocSnap.id,
            // Ensure date fields that might be Timestamps are converted to ISO strings for consistency if needed,
            // or directly to Date objects if DetailItem handles them.
            // For DetailItem, passing Firestore Timestamp directly is fine.
            joiningDate: data.joiningDate, // Keep as Timestamp or convert based on DetailItem
            dateOfBirth: data.dateOfBirth, // Keep as Timestamp or convert
            exitDate: data.exitDate, // Keep as Timestamp or convert
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          } as Employee;
          setEmployee(formattedData);
        } else {
          setError("Employee not found with the provided ID.");
          toast({ variant: "destructive", title: "Not Found", description: "No employee record found for this ID."});
        }
      } catch (err: any) {
        console.error("Error fetching employee:", err);
        setError(err.message || "Failed to fetch employee data.");
        toast({ variant: "destructive", title: "Fetch Error", description: "Could not retrieve employee details."});
      } finally {
        setIsLoading(false);
      }
    };

    fetchEmployee();
  }, [employeeIdFromUrl, toast]);


  const getStatusBadgeVariant = (status?: Employee['status']) => {
    switch (status) {
      case 'Active': return 'default';
      case 'Inactive': return 'destructive';
      case 'OnLeave': return 'secondary';
      case 'Exited': return 'destructive';
      default: return 'outline';
    }
  };

  const handleDownloadProfile = () => {
    // Placeholder for actual PDF generation and download
    toast({
      title: "Download Requested",
      description: "CV/Biodata download functionality is under development.",
    });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[calc(100vh-200px)]">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="ml-4 text-lg text-muted-foreground">Loading employee profile...</p>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" className="max-w-lg mx-auto my-10">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>
            {error}
            <Button onClick={() => router.push('/employees')} className="mt-4">Back to Directory</Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!employee) {
    return (
         <Alert variant="default" className="max-w-lg mx-auto my-10">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Employee Not Found</AlertTitle>
            <AlertDescription>
                The requested employee profile could not be found.
                <Button onClick={() => router.push('/employees')} className="mt-4">Back to Directory</Button>
            </AlertDescription>
        </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <Image
            src={employee.profilePictureUrl || "https://placehold.co/128x128.png"}
            alt={employee.fullName || 'Employee profile picture'}
            width={100}
            height={100}
            className="rounded-full border-4 border-primary shadow-md object-cover"
            data-ai-hint="profile picture"
          />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{employee.fullName}</h1>
            <p className="text-muted-foreground">{employee.employeeId} - {employee.clientName || "N/A"}</p>
            <Badge variant={getStatusBadgeVariant(employee.status)} className="mt-1">{employee.status}</Badge>
          </div>
        </div>
        <div className="flex gap-2">
            <Button onClick={handleDownloadProfile} variant="outline">
                <Download className="mr-2 h-4 w-4" /> Download Profile
            </Button>
            <Button onClick={() => setIsEditing(!isEditing)}>
                <Edit3 className="mr-2 h-4 w-4" /> {isEditing ? "Save Changes" : "Edit Profile"}
            </Button>
        </div>
      </div>

      <Tabs defaultValue="personal">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-5 gap-2">
          <TabsTrigger value="personal"><User className="mr-2 h-4 w-4 sm:hidden md:inline-block" />Personal</TabsTrigger>
          <TabsTrigger value="employment"><Briefcase className="mr-2 h-4 w-4 sm:hidden md:inline-block" />Employment</TabsTrigger>
          <TabsTrigger value="bank"><Banknote className="mr-2 h-4 w-4 sm:hidden md:inline-block" />Bank</TabsTrigger>
          <TabsTrigger value="identification"><ShieldCheck className="mr-2 h-4 w-4 sm:hidden md:inline-block" />Identification</TabsTrigger>
          <TabsTrigger value="qr"><QrCode className="mr-2 h-4 w-4 sm:hidden md:inline-block" />QR & Docs</TabsTrigger>
        </TabsList>

        <Card className="mt-4">
          <CardContent className="pt-6">
            <TabsContent value="personal">
              <CardTitle className="mb-4">Personal Information</CardTitle>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                <DetailItem label="First Name" value={employee.firstName} />
                <DetailItem label="Last Name" value={employee.lastName} />
                <DetailItem label="Date of Birth" value={employee.dateOfBirth} isDate />
                <DetailItem label="Gender" value={employee.gender} />
                <DetailItem label="Father's Name" value={employee.fatherName} />
                <DetailItem label="Mother's Name" value={employee.motherName} />
                <DetailItem label="Marital Status" value={employee.maritalStatus} />
                {employee.maritalStatus === "Married" && <DetailItem label="Spouse Name" value={employee.spouseName} />}
                <DetailItem label="District" value={employee.district} />
              </div>
              <Separator className="my-6" />
              <CardTitle className="text-lg mb-2">Contact Details</CardTitle>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                <DetailItem label="Phone Number" value={employee.phoneNumber} />
                <DetailItem label="Email Address" value={employee.emailAddress} />
                 <div className="md:col-span-2">
                    <DetailItem label="Full Address" value={employee.fullAddress} />
                 </div>
              </div>
            </TabsContent>

            <TabsContent value="employment">
              <CardTitle className="mb-4">Employment Details</CardTitle>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                <DetailItem label="Employee ID" value={employee.employeeId} />
                <DetailItem label="Client Name" value={employee.clientName} />
                {employee.resourceIdNumber && <DetailItem label="Resource ID" value={employee.resourceIdNumber} />}
                <DetailItem label="Joining Date" value={employee.joiningDate} isDate />
                <DetailItem label="Status" value={employee.status} />
                {employee.status === 'Exited' && employee.exitDate && (
                    <DetailItem label="Exit Date" value={employee.exitDate} isDate />
                )}
              </div>
            </TabsContent>

            <TabsContent value="bank">
              <CardTitle className="mb-4">Bank Account Details</CardTitle>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                <DetailItem label="Bank Name" value={employee.bankName} />
                <DetailItem label="Account Number" value={employee.bankAccountNumber} />
                <DetailItem label="IFSC Code" value={employee.ifscCode} />
              </div>
            </TabsContent>

            <TabsContent value="identification">
              <CardTitle className="mb-4">Identification Details</CardTitle>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                <DetailItem label="PAN Number" value={employee.panNumber} />
                <DetailItem label="ID Proof Type" value={employee.idProofType} />
                <DetailItem label="ID Proof Number" value={employee.idProofNumber} />
                <DetailItem label="EPF UAN Number" value={employee.epfUanNumber} />
                <DetailItem label="ESIC Number" value={employee.esicNumber} />
              </div>
            </TabsContent>

            <TabsContent value="qr">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <CardTitle className="mb-4">Employee QR Code</CardTitle>
                    <div className="flex flex-col items-center p-4 border rounded-md shadow-sm bg-muted/20">
                        {employee.qrCodeUrl ? (
                            <Image src={employee.qrCodeUrl} alt="Employee QR Code" width={200} height={200} data-ai-hint="qr code employee" />
                        ) : (
                            <p className="text-muted-foreground">QR Code not available.</p>
                        )}
                        <Button variant="outline" className="mt-4" disabled>
                            <QrCode className="mr-2 h-4 w-4" /> Regenerate QR (soon)
                        </Button>
                        {employee.qrCodeUrl && employee.qrCodeUrl.startsWith('data:image/png;base64,') && (
                           <p className="text-xs text-muted-foreground mt-2 truncate w-full text-center" title={decodeURIComponent(employee.qrCodeUrl.split('data=')[1] || '')}>
                                QR Data URL (truncated)
                           </p>
                        )}
                    </div>
                </div>
                <div>
                    <CardTitle className="mb-4">Uploaded Documents</CardTitle>
                    <div className="space-y-3">
                        <DocumentItem name="Profile Picture" url={employee.profilePictureUrl} type="Employee Photo" />
                        <DocumentItem name="ID Proof" url={employee.idProofDocumentUrl} type={employee.idProofType || "ID Document"} />
                        <DocumentItem name="Bank Passbook/Statement" url={employee.bankPassbookStatementUrl} type="Bank Document" />
                        <div className="pt-4">
                             <Label htmlFor="new-doc" className="text-sm font-medium">Upload New Document (Placeholder)</Label>
                             <div className="flex gap-2 mt-1">
                                <Input id="new-doc" type="file" className="flex-grow" disabled />
                                <Button size="sm" disabled><FileUp className="mr-2 h-4 w-4" /> Upload</Button>
                             </div>
                             <p className="text-xs text-muted-foreground mt-1">Max 5MB. PDF, JPG, PNG accepted.</p>
                        </div>
                    </div>
                </div>
              </div>
            </TabsContent>
          </CardContent>
        </Card>
      </Tabs>

      {isEditing && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Edit Profile Information</CardTitle>
            <CardDescription>Update employee details here. This is a placeholder for the actual edit form.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">Edit form components would go here, pre-filled and allowing updates. Save would update Firestore document.</p>
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
            <Button onClick={() => { /* Handle save logic */ setIsEditing(false); toast({title: "Save (Placeholder)", description:"Save functionality to be implemented."}) }}>Save Changes</Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
