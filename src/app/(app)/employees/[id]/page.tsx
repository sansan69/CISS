
"use client";

import { useParams } from 'next/navigation';
import Image from 'next/image';
import { mockEmployees, type Employee } from '@/types/employee';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Edit3, User, Briefcase, Banknote, ShieldCheck, QrCode, FileUp, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import React from 'react';

const DetailItem: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
  <div className="grid grid-cols-3 gap-2 py-1.5">
    <span className="text-sm text-muted-foreground col-span-1">{label}</span>
    <span className="text-sm font-medium col-span-2">{value || 'N/A'}</span>
  </div>
);

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
                    <Download className="mr-2 h-4 w-4" /> View
                </a>
            </Button>
        ) : (
            <Badge variant="outline">Not Uploaded</Badge>
        )}
    </div>
);


export default function EmployeeProfilePage() {
  const params = useParams();
  const employeeId = params.id as string;
  const employee = mockEmployees.find(emp => emp.id === employeeId);
  const [isEditing, setIsEditing] = React.useState(false); // Placeholder for edit state

  if (!employee) {
    return <div className="text-center py-10">Employee not found.</div>;
  }
  
  const getStatusBadgeVariant = (status: Employee['status']) => {
    switch (status) {
      case 'Active': return 'default';
      case 'Inactive': return 'destructive';
      case 'OnLeave': return 'secondary';
      default: return 'outline';
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <Image 
            src={employee.profilePictureUrl || "https://placehold.co/128x128.png"} 
            alt={employee.fullName}
            width={100}
            height={100}
            className="rounded-full border-4 border-primary shadow-md"
            data-ai-hint="profile picture"
          />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{employee.fullName}</h1>
            <p className="text-muted-foreground">{employee.employeeId} - {employee.department || "N/A"}</p>
            <Badge variant={getStatusBadgeVariant(employee.status)} className="mt-1">{employee.status}</Badge>
          </div>
        </div>
        <Button onClick={() => setIsEditing(!isEditing)}>
          <Edit3 className="mr-2 h-4 w-4" /> {isEditing ? "Save Changes" : "Edit Profile"}
        </Button>
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
                <DetailItem label="Date of Birth" value={format(new Date(employee.dateOfBirth), "PPP")} />
                <DetailItem label="Gender" value={employee.gender} />
                <DetailItem label="Father's Name" value={employee.fatherName} />
                <DetailItem label="Mother's Name" value={employee.motherName} />
                <DetailItem label="Marital Status" value={employee.maritalStatus} />
                <DetailItem label="Nationality" value={employee.nationality} />
                <DetailItem label="Religion" value={employee.religion} />
                <DetailItem label="Blood Group" value={employee.bloodGroup} />
              </div>
              <Separator className="my-6" />
              <CardTitle className="text-lg mb-2">Contact Details</CardTitle>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                <DetailItem label="Mobile Number" value={employee.mobileNumber} />
                <DetailItem label="Alternate Mobile" value={employee.alternateMobile} />
                <DetailItem label="Email ID" value={employee.emailId} />
                 <div className="md:col-span-2">
                    <DetailItem label="Present Address" value={employee.presentAddress} />
                 </div>
                 <div className="md:col-span-2">
                    <DetailItem label="Permanent Address" value={employee.permanentAddress} />
                 </div>
              </div>
            </TabsContent>

            <TabsContent value="employment">
              <CardTitle className="mb-4">Employment Details</CardTitle>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                <DetailItem label="Employee ID" value={employee.employeeId} />
                <DetailItem label="Joining Date" value={format(new Date(employee.joiningDate), "PPP")} />
                <DetailItem label="Department" value={employee.department} />
                <DetailItem label="Status" value={employee.status} />
              </div>
            </TabsContent>

            <TabsContent value="bank">
              <CardTitle className="mb-4">Bank Account Details</CardTitle>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                <DetailItem label="Bank Name" value={employee.bankName} />
                <DetailItem label="Account Number" value={employee.accountNumber} />
                <DetailItem label="IFSC Code" value={employee.ifscCode} />
                <DetailItem label="Branch Name" value={employee.branchName} />
              </div>
            </TabsContent>

            <TabsContent value="identification">
              <CardTitle className="mb-4">Identification Details</CardTitle>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                <DetailItem label="Aadhar Number" value={employee.aadharNumber} />
                <DetailItem label="PAN Number" value={employee.panNumber} />
                <DetailItem label="UAN Number" value={employee.uanNumber} />
                <DetailItem label="ESIC Number" value={employee.esicNumber} />
                <DetailItem label="PF Number" value={employee.pfNumber} />
              </div>
            </TabsContent>

            <TabsContent value="qr">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <CardTitle className="mb-4">Employee QR Code</CardTitle>
                    <div className="flex flex-col items-center p-4 border rounded-md shadow-sm bg-muted/20">
                        <Image src={employee.qrCodeUrl || "https://placehold.co/200x200.png"} alt="Employee QR Code" width={200} height={200} data-ai-hint="qr code" />
                        <Button variant="outline" className="mt-4">
                            <QrCode className="mr-2 h-4 w-4" /> Regenerate QR Code
                        </Button>
                        <p className="text-xs text-muted-foreground mt-2">Filename: {employee.mobileNumber}.png</p>
                    </div>
                </div>
                <div>
                    <CardTitle className="mb-4">Uploaded Documents</CardTitle>
                    <div className="space-y-3">
                        <DocumentItem name="ID Proof" url={employee.idProofUrl} type="Aadhar/PAN/Voter ID" />
                        <DocumentItem name="Bank Passbook" url={employee.bankPassbookUrl} type="Passbook/Cancelled Cheque" />
                        <div className="pt-4">
                             <Label htmlFor="new-doc" className="text-sm font-medium">Upload New Document</Label>
                             <div className="flex gap-2 mt-1">
                                <Input id="new-doc" type="file" className="flex-grow" />
                                <Button size="sm"><FileUp className="mr-2 h-4 w-4" /> Upload</Button>
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
            <p className="text-muted-foreground">Edit form components would go here, similar to the enrollment form but pre-filled and allowing updates.</p>
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
            <Button onClick={() => { /* Handle save logic */ setIsEditing(false); }}>Save Changes</Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
