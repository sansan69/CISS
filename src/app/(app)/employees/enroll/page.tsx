
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarIcon, UserPlus, FileUp, Check, ArrowLeft, Upload, Camera, UserCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import React from "react";
import Link from "next/link";
import Image from "next/image";

const enrollmentFormSchema = z.object({
  // Client Information
  joiningDate: z.date({ required_error: "Joining date is required." }),
  clientName: z.string({ required_error: "Client name is required." }),
  resourceIdNumber: z.string().optional(), // Optional by default

  // Personal Information
  profilePicture: z.any().optional().refine(file => file?.name, "Profile picture is required."),
  firstName: z.string().min(1, { message: "First name is required." }),
  lastName: z.string().min(1, { message: "Last name is required." }),
  fatherName: z.string().min(2, { message: "Father's name is required." }),
  motherName: z.string().min(2, { message: "Mother's name is required." }),
  dateOfBirth: z.date({ required_error: "Date of birth is required." }),
  gender: z.enum(["Male", "Female", "Other"], { required_error: "Gender is required." }),
  maritalStatus: z.enum(["Single", "Married", "Divorced", "Widowed", "Unmarried"], { required_error: "Marital status is required." }),

  // Location & Identification
  district: z.string({ required_error: "District is required." }),
  panNumber: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, { message: "Invalid PAN number format (e.g., ABCDE1234F)." }).optional().or(z.literal('')),
  idProofType: z.enum(["Aadhar Card", "Voter ID", "Driving License", "Passport"], { required_error: "ID proof type is required." }),
  idProofNumber: z.string().min(5, { message: "ID proof number is required (min 5 chars)." }),
  idProofDocument: z.any().optional().refine(file => file?.name, "ID proof document is required."),

  // Bank Account Details
  bankAccountNumber: z.string().min(5, { message: "Bank account number is required." }),
  ifscCode: z.string().length(11, { message: "IFSC code must be 11 characters." }),
  bankName: z.string().min(2, { message: "Bank name is required." }),
  bankPassbookStatement: z.any().optional().refine(file => file?.name, "Bank passbook/statement is required."),

  // Contact Information
  fullAddress: z.string().min(10, { message: "Full address is required (min 10 chars)." }),
  emailAddress: z.string().email({ message: "Invalid email address." }),
  phoneNumber: z.string().regex(/^\d{10}$/, { message: "Phone number must be 10 digits." }),
}).superRefine((data, ctx) => {
  if (data.clientName === "TCS" && (!data.resourceIdNumber || data.resourceIdNumber.trim() === "")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Resource ID number is required for TCS client.",
      path: ["resourceIdNumber"],
    });
  }
});

type EnrollmentFormValues = z.infer<typeof enrollmentFormSchema>;

// In a real application, this list would be dynamic and managed by an admin.
const clientNames = ["TCS", "Wipro", "Infosys", "Client A", "Client B", "Other"];
const keralaDistricts = [
  "Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha", 
  "Kottayam", "Idukki", "Ernakulam", "Thrissur", "Palakkad", 
  "Malappuram", "Kozhikode", "Wayanad", "Kannur", "Kasaragod"
];
const idProofTypes = ["Aadhar Card", "Voter ID", "Driving License", "Passport"];
const maritalStatuses = ["Unmarried", "Married", "Divorced", "Widowed", "Single"];

export default function EnrollEmployeePage() {
  const { toast } = useToast();
  const [profilePicPreview, setProfilePicPreview] = React.useState<string | null>(null);
  const [idProofPreview, setIdProofPreview] = React.useState<string | null>(null);
  const [bankPassbookPreview, setBankPassbookPreview] = React.useState<string | null>(null);

  const form = useForm<EnrollmentFormValues>({
    resolver: zodResolver(enrollmentFormSchema),
    defaultValues: {
      clientName: undefined,
      resourceIdNumber: "",
      firstName: "",
      lastName: "",
      fatherName: "",
      motherName: "",
      gender: undefined,
      maritalStatus: undefined,
      district: undefined,
      panNumber: "",
      idProofType: undefined,
      idProofNumber: "",
      bankAccountNumber: "",
      ifscCode: "",
      bankName: "",
      fullAddress: "",
      emailAddress: "",
      phoneNumber: "",
      profilePicture: null,
      idProofDocument: null,
      bankPassbookStatement: null,
    },
  });

  const watchClientName = form.watch("clientName");

  function onSubmit(data: EnrollmentFormValues) {
    console.log(data);
    toast({
      title: "Registration Submitted",
      description: `${data.firstName} ${data.lastName}'s registration has been submitted.`,
      action: <Check className="h-5 w-5 text-green-500" />,
    });
    form.reset();
    setProfilePicPreview(null);
    setIdProofPreview(null);
    setBankPassbookPreview(null);
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>, fieldName: keyof EnrollmentFormValues, setPreview: React.Dispatch<React.SetStateAction<string | null>>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      form.setValue(fieldName, file); // Store the File object
      setPreview(URL.createObjectURL(file));
    } else {
      form.setValue(fieldName, null);
      setPreview(null);
    }
  };
  
  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="mb-6">
        <Link href="/" className="flex items-center text-sm text-primary hover:underline">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Home
        </Link>
      </div>

      <Card className="shadow-xl">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Employee Registration</CardTitle>
          <CardDescription>Complete your employee profile with accurate information</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              
              {/* Client Information */}
              <section>
                <h2 className="text-xl font-semibold mb-4 border-b pb-2">Client Information</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="joiningDate"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Joining Date <span className="text-destructive">*</span></FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal", !field.value && "text-muted-foreground")}>
                                {field.value ? format(field.value, "dd-MM-yyyy") : <span>dd-mm-yyyy</span>}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus disabled={(date) => date > new Date()} />
                          </PopoverContent>
                        </Popover>
                        <FormDescription>Your first day of employment</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="clientName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Client Name <span className="text-destructive">*</span></FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {clientNames.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormDescription>Client you are deployed with. (Admin can manage this list)</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {watchClientName === "TCS" && (
                    <FormField 
                      control={form.control} 
                      name="resourceIdNumber" 
                      render={({ field }) => (
                        <FormItem className="md:col-span-2">
                          <FormLabel>Resource ID Number <span className="text-destructive">*</span></FormLabel>
                          <FormControl><Input placeholder="Enter Resource ID Number" {...field} /></FormControl>
                          <FormDescription>Required if client is TCS. E.g., TCS12345</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )} 
                    />
                  )}
                </div>
              </section>

              {/* Personal Information */}
              <section>
                <h2 className="text-xl font-semibold mb-4 border-b pb-2">Personal Information</h2>
                <FormField
                  control={form.control}
                  name="profilePicture"
                  render={({ field }) => ( // field is passed but not directly used for value, onChange for file input is custom
                    <FormItem className="mb-6 text-center">
                      <FormLabel className="block mb-2 text-sm font-medium">Profile Picture <span className="text-destructive">*</span></FormLabel>
                       <div className="flex flex-col items-center gap-4">
                        {profilePicPreview ? (
                          <Image src={profilePicPreview} alt="Profile preview" width={128} height={128} className="rounded-full object-cover h-32 w-32 border" data-ai-hint="profile photo" />
                        ) : (
                          <div className="flex items-center justify-center h-32 w-32 rounded-full bg-muted border">
                            <UserCircle2 className="h-20 w-20 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex gap-2">
                           <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById('profilePictureInput')?.click()}>
                            <Upload className="mr-2 h-4 w-4" /> Upload Photo
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => alert("Camera functionality to be implemented.")}>
                            <Camera className="mr-2 h-4 w-4" /> Take Photo
                          </Button>
                        </div>
                        <FormControl>
                           <Input 
                            id="profilePictureInput"
                            type="file" 
                            className="hidden" 
                            accept="image/*" 
                            onChange={(e) => handleFileChange(e, "profilePicture", setProfilePicPreview)}
                          />
                        </FormControl>
                         <FormDescription>Upload a clear passport-sized photo (will be resized to 500x500px)</FormDescription>
                        <FormMessage />
                       </div>
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField control={form.control} name="firstName" render={({ field }) => (<FormItem><FormLabel>First Name <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="Enter first name" {...field} /></FormControl><FormDescription>Your given name</FormDescription><FormMessage /></FormItem>)} />
                  <FormField control={form.control} name="lastName" render={({ field }) => (<FormItem><FormLabel>Last Name <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="Enter last name" {...field} /></FormControl><FormDescription>Your family name</FormDescription><FormMessage /></FormItem>)} />
                  <FormField control={form.control} name="fatherName" render={({ field }) => (<FormItem><FormLabel>Father's Name <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="Enter father's name" {...field} /></FormControl><FormDescription>Your father's full name</FormDescription><FormMessage /></FormItem>)} />
                  <FormField control={form.control} name="motherName" render={({ field }) => (<FormItem><FormLabel>Mother's Name <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="Enter mother's name" {...field} /></FormControl><FormDescription>Your mother's full name</FormDescription><FormMessage /></FormItem>)} />
                   <FormField
                    control={form.control}
                    name="dateOfBirth"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Date of Birth <span className="text-destructive">*</span></FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal", !field.value && "text-muted-foreground")}>
                                {field.value ? format(field.value, "dd-MM-yyyy") : <span>dd-mm-yyyy</span>}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar mode="single" selected={field.value} onSelect={field.onChange} disabled={(date) => date > new Date() || date < new Date("1900-01-01")} initialFocus />
                          </PopoverContent>
                        </Popover>
                        <FormDescription>Your date of birth</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="gender"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Gender <span className="text-destructive">*</span></FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="Male">Male</SelectItem>
                            <SelectItem value="Female">Female</SelectItem>
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormDescription>Your gender</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                   <FormField
                    control={form.control}
                    name="maritalStatus"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Marital Status <span className="text-destructive">*</span></FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select marital status" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {maritalStatuses.map(status => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormDescription>Your current marital status</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </section>

              {/* Location & Identification */}
              <section>
                <h2 className="text-xl font-semibold mb-4 border-b pb-2">Location & Identification</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="district"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>District <span className="text-destructive">*</span></FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select your district" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {keralaDistricts.map(dist => <SelectItem key={dist} value={dist}>{dist}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormDescription>Your current district of residence</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField control={form.control} name="panNumber" render={({ field }) => (<FormItem><FormLabel>PAN Card Number</FormLabel><FormControl><Input placeholder="Enter PAN card number (if available)" {...field} /></FormControl><FormDescription>Your Permanent Account Number (optional)</FormDescription><FormMessage /></FormItem>)} />
                  <FormField
                    control={form.control}
                    name="idProofType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>ID Proof Type <span className="text-destructive">*</span></FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select ID proof type" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {idProofTypes.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormDescription>Type of identity document you're providing</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField control={form.control} name="idProofNumber" render={({ field }) => (<FormItem><FormLabel>ID Proof Number <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="Enter ID proof number" {...field} /></FormControl><FormDescription>Number on your selected identity document</FormDescription><FormMessage /></FormItem>)} />
                  <FormField
                    control={form.control}
                    name="idProofDocument"
                    render={({ field }) => ( // field is passed but not directly used for value
                      <FormItem className="md:col-span-2 text-center">
                        <FormLabel className="block mb-2">ID Proof Document <span className="text-destructive">*</span></FormLabel>
                        {idProofPreview && <Image src={idProofPreview} alt="ID Proof Preview" width={200} height={120} className="mx-auto mb-2 border object-contain h-32" data-ai-hint="id document"/>}
                        <div className="flex justify-center gap-2">
                           <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById('idProofDocumentInput')?.click()}>
                            <Upload className="mr-2 h-4 w-4" /> Upload ID Proof
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => alert("Camera functionality to be implemented.")}>
                            <Camera className="mr-2 h-4 w-4" /> Take Photo of ID
                          </Button>
                        </div>
                        <FormControl>
                          <Input id="idProofDocumentInput" type="file" className="hidden" accept="image/*,.pdf" onChange={(e) => handleFileChange(e, "idProofDocument", setIdProofPreview)} />
                        </FormControl>
                         <FormDescription>Upload a clear photo of your ID document (will be resized to 800x600px)</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </section>
              
              {/* Bank Account Details */}
              <section>
                <h2 className="text-xl font-semibold mb-4 border-b pb-2">Bank Account Details</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField control={form.control} name="bankAccountNumber" render={({ field }) => (<FormItem><FormLabel>Bank Account Number <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="Enter your bank account number" {...field} /></FormControl><FormDescription>The account where your salary will be deposited</FormDescription><FormMessage /></FormItem>)} />
                  <FormField control={form.control} name="ifscCode" render={({ field }) => (<FormItem><FormLabel>IFSC Code <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="Enter bank IFSC code" {...field} /></FormControl><FormDescription>11-character code that uniquely identifies your bank branch</FormDescription><FormMessage /></FormItem>)} />
                  <FormField control={form.control} name="bankName" render={({ field }) => (<FormItem className="md:col-span-2"><FormLabel>Bank Name <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="Full name of your bank (e.g., State Bank of India)" {...field} /></FormControl><FormMessage /></FormItem>)} />
                   <FormField
                    control={form.control}
                    name="bankPassbookStatement"
                    render={({ field }) => ( // field is passed but not directly used for value
                       <FormItem className="md:col-span-2 text-center">
                        <FormLabel className="block mb-2">Bank Passbook / Statement <span className="text-destructive">*</span></FormLabel>
                        {bankPassbookPreview && <Image src={bankPassbookPreview} alt="Bank Passbook Preview" width={200} height={120} className="mx-auto mb-2 border object-contain h-32" data-ai-hint="bank document"/>}
                         <div className="flex justify-center gap-2">
                           <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById('bankPassbookStatementInput')?.click()}>
                            <Upload className="mr-2 h-4 w-4" /> Upload Document
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => alert("Camera functionality to be implemented.")}>
                            <Camera className="mr-2 h-4 w-4" /> Take Photo
                          </Button>
                        </div>
                        <FormControl>
                          <Input id="bankPassbookStatementInput" type="file" className="hidden" accept="image/*,.pdf" onChange={(e) => handleFileChange(e, "bankPassbookStatement", setBankPassbookPreview)} />
                        </FormControl>
                        <FormDescription>Upload a clear photo of your bank passbook or statement (will be compressed)</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </section>

              {/* Contact Information */}
              <section>
                <h2 className="text-xl font-semibold mb-4 border-b pb-2">Contact Information</h2>
                <div className="grid grid-cols-1 gap-6">
                  <FormField
                    control={form.control}
                    name="fullAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Full Address <span className="text-destructive">*</span></FormLabel>
                        <FormControl><Textarea placeholder="Enter your complete residential address" {...field} /></FormControl>
                        <FormDescription>Include apartment/house number, street, area, and PIN code</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                  <FormField control={form.control} name="emailAddress" render={({ field }) => (<FormItem><FormLabel>Email Address <span className="text-destructive">*</span></FormLabel><FormControl><Input type="email" placeholder="yourname@example.com" {...field} /></FormControl><FormDescription>Your email for official communications and alerts</FormDescription><FormMessage /></FormItem>)} />
                  <FormField control={form.control} name="phoneNumber" render={({ field }) => (<FormItem><FormLabel>Phone Number <span className="text-destructive">*</span></FormLabel><FormControl><Input type="tel" placeholder="+910123456787" {...field} /></FormControl><FormDescription>Your registered phone number for official communications</FormDescription><FormMessage /></FormItem>)} />
                </div>
              </section>

              <div className="flex justify-end pt-6">
                <Button type="submit" className="w-full md:w-auto bg-indigo-600 hover:bg-indigo-700 text-white py-3 px-6 text-base" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? "Submitting..." : "Complete Registration"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

    