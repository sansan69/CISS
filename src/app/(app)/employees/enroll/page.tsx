
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
import { CalendarIcon, UserPlus, FileUp, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import React from "react";

const enrollmentFormSchema = z.object({
  // Personal Information
  fullName: z.string().min(2, { message: "Full name must be at least 2 characters." }),
  dateOfBirth: z.date({ required_error: "Date of birth is required." }),
  gender: z.enum(["Male", "Female", "Other"], { required_error: "Gender is required." }),
  fatherName: z.string().min(2, { message: "Father's name is required." }),
  motherName: z.string().min(2, { message: "Mother's name is required." }),
  maritalStatus: z.enum(["Single", "Married", "Divorced", "Widowed"], { required_error: "Marital status is required." }),
  nationality: z.string().min(2, { message: "Nationality is required." }),
  religion: z.string().optional(),
  bloodGroup: z.string().optional(),
  joiningDate: z.date({ required_error: "Joining date is required." }),
  department: z.string().optional(),
  employeeId: z.string().min(3, { message: "Employee ID is required." }),
  status: z.enum(["Active", "Inactive", "OnLeave"], { required_error: "Status is required." }),

  // Contact Information
  presentAddress: z.string().min(5, { message: "Present address is required." }),
  permanentAddress: z.string().min(5, { message: "Permanent address is required." }),
  mobileNumber: z.string().regex(/^\d{10}$/, { message: "Mobile number must be 10 digits." }),
  alternateMobile: z.string().regex(/^\d{10}$/, { message: "Alternate mobile must be 10 digits." }).optional().or(z.literal('')),
  emailId: z.string().email({ message: "Invalid email address." }),

  // Identification
  aadharNumber: z.string().regex(/^\d{12}$/, { message: "Aadhar number must be 12 digits." }),
  panNumber: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, { message: "Invalid PAN number format." }),
  uanNumber: z.string().optional(),
  esicNumber: z.string().optional(),
  pfNumber: z.string().optional(),

  // Bank Details
  bankName: z.string().min(2, { message: "Bank name is required." }),
  accountNumber: z.string().min(5, { message: "Account number is required." }),
  ifscCode: z.string().min(5, { message: "IFSC code is required." }), // Basic validation, can be improved
  branchName: z.string().min(2, { message: "Branch name is required." }),

  // Document Uploads (represented as file inputs, actual upload logic is backend)
  profilePicture: z.any().optional(), // Using `any` for File type from input
  idProof: z.any().optional(),
  bankPassbook: z.any().optional(),
});

type EnrollmentFormValues = z.infer<typeof enrollmentFormSchema>;

export default function EnrollEmployeePage() {
  const { toast } = useToast();
  const form = useForm<EnrollmentFormValues>({
    resolver: zodResolver(enrollmentFormSchema),
    defaultValues: {
      fullName: "",
      gender: undefined,
      fatherName: "",
      motherName: "",
      maritalStatus: undefined,
      nationality: "Indian",
      religion: "",
      bloodGroup: "",
      employeeId: "",
      status: "Active",
      department: "",
      presentAddress: "",
      permanentAddress: "",
      mobileNumber: "",
      alternateMobile: "",
      emailId: "",
      aadharNumber: "",
      panNumber: "",
      uanNumber: "",
      esicNumber: "",
      pfNumber: "",
      bankName: "",
      accountNumber: "",
      ifscCode: "",
      branchName: "",
    },
  });

  function onSubmit(data: EnrollmentFormValues) {
    console.log(data);
    // Here you would typically send data to your backend
    toast({
      title: "Enrollment Submitted",
      description: `${data.fullName} has been successfully submitted for enrollment.`,
      action: <Check className="h-5 w-5 text-green-500" />,
    });
    form.reset(); // Reset form after submission
  }

  const SectionCard: React.FC<{ title: string; description?: string; children: React.ReactNode }> = ({ title, description, children }) => (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {children}
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Enroll New Employee</h1>
        <UserPlus className="h-8 w-8 text-primary" />
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <SectionCard title="Personal Information">
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl><Input placeholder="Enter full name" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="dateOfBirth"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Date of Birth</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant={"outline"}
                          className={cn(
                            "w-full pl-3 text-left font-normal",
                            !field.value && "text-muted-foreground"
                          )}
                        >
                          {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        disabled={(date) => date > new Date() || date < new Date("1900-01-01")}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="gender"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Gender</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="Male">Male</SelectItem>
                      <SelectItem value="Female">Female</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField control={form.control} name="fatherName" render={({ field }) => (<FormItem><FormLabel>Father's Name</FormLabel><FormControl><Input placeholder="Father's full name" {...field} /></FormControl><FormMessage /></FormItem>)} />
            <FormField control={form.control} name="motherName" render={({ field }) => (<FormItem><FormLabel>Mother's Name</FormLabel><FormControl><Input placeholder="Mother's full name" {...field} /></FormControl><FormMessage /></FormItem>)} />
            <FormField
              control={form.control}
              name="maritalStatus"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Marital Status</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select marital status" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="Single">Single</SelectItem>
                      <SelectItem value="Married">Married</SelectItem>
                      <SelectItem value="Divorced">Divorced</SelectItem>
                      <SelectItem value="Widowed">Widowed</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField control={form.control} name="nationality" render={({ field }) => (<FormItem><FormLabel>Nationality</FormLabel><FormControl><Input placeholder="e.g. Indian" {...field} /></FormControl><FormMessage /></FormItem>)} />
            <FormField control={form.control} name="religion" render={({ field }) => (<FormItem><FormLabel>Religion (Optional)</FormLabel><FormControl><Input placeholder="e.g. Hindu" {...field} /></FormControl><FormMessage /></FormItem>)} />
            <FormField control={form.control} name="bloodGroup" render={({ field }) => (<FormItem><FormLabel>Blood Group (Optional)</FormLabel><FormControl><Input placeholder="e.g. O+" {...field} /></FormControl><FormMessage /></FormItem>)} />
          </SectionCard>

          <SectionCard title="Employment Details">
            <FormField control={form.control} name="employeeId" render={({ field }) => (<FormItem><FormLabel>Employee ID</FormLabel><FormControl><Input placeholder="Enter Employee ID" {...field} /></FormControl><FormMessage /></FormItem>)} />
             <FormField
              control={form.control}
              name="joiningDate"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Joining Date</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant={"outline"}
                          className={cn(
                            "w-full pl-3 text-left font-normal",
                            !field.value && "text-muted-foreground"
                          )}
                        >
                          {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        disabled={(date) => date > new Date()}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField control={form.control} name="department" render={({ field }) => (<FormItem><FormLabel>Department (Optional)</FormLabel><FormControl><Input placeholder="e.g. IT, Operations" {...field} /></FormControl><FormMessage /></FormItem>)} />
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="Active">Active</SelectItem>
                      <SelectItem value="Inactive">Inactive</SelectItem>
                      <SelectItem value="OnLeave">On Leave</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SectionCard>

          <SectionCard title="Contact Information">
            <FormField
              control={form.control}
              name="presentAddress"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Present Address</FormLabel>
                  <FormControl><Textarea placeholder="Full present address" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
             <FormField
              control={form.control}
              name="permanentAddress"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Permanent Address</FormLabel>
                  <FormControl><Textarea placeholder="Full permanent address" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField control={form.control} name="mobileNumber" render={({ field }) => (<FormItem><FormLabel>Mobile Number</FormLabel><FormControl><Input type="tel" placeholder="10-digit mobile number" {...field} /></FormControl><FormMessage /></FormItem>)} />
            <FormField control={form.control} name="alternateMobile" render={({ field }) => (<FormItem><FormLabel>Alternate Mobile (Optional)</FormLabel><FormControl><Input type="tel" placeholder="10-digit mobile number" {...field} /></FormControl><FormMessage /></FormItem>)} />
            <FormField control={form.control} name="emailId" render={({ field }) => (<FormItem><FormLabel>Email ID</FormLabel><FormControl><Input type="email" placeholder="employee@example.com" {...field} /></FormControl><FormMessage /></FormItem>)} />
          </SectionCard>

          <SectionCard title="Identification Details">
            <FormField control={form.control} name="aadharNumber" render={({ field }) => (<FormItem><FormLabel>Aadhar Number</FormLabel><FormControl><Input placeholder="12-digit Aadhar" {...field} /></FormControl><FormMessage /></FormItem>)} />
            <FormField control={form.control} name="panNumber" render={({ field }) => (<FormItem><FormLabel>PAN Number</FormLabel><FormControl><Input placeholder="ABCDE1234F" {...field} /></FormControl><FormMessage /></FormItem>)} />
            <FormField control={form.control} name="uanNumber" render={({ field }) => (<FormItem><FormLabel>UAN Number (Optional)</FormLabel><FormControl><Input placeholder="Universal Account Number" {...field} /></FormControl><FormMessage /></FormItem>)} />
            <FormField control={form.control} name="esicNumber" render={({ field }) => (<FormItem><FormLabel>ESIC Number (Optional)</FormLabel><FormControl><Input placeholder="ESIC registration number" {...field} /></FormControl><FormMessage /></FormItem>)} />
            <FormField control={form.control} name="pfNumber" render={({ field }) => (<FormItem><FormLabel>PF Number (Optional)</FormLabel><FormControl><Input placeholder="Provident Fund number" {...field} /></FormControl><FormMessage /></FormItem>)} />
          </SectionCard>

          <SectionCard title="Bank Account Details">
            <FormField control={form.control} name="bankName" render={({ field }) => (<FormItem><FormLabel>Bank Name</FormLabel><FormControl><Input placeholder="e.g. State Bank of India" {...field} /></FormControl><FormMessage /></FormItem>)} />
            <FormField control={form.control} name="accountNumber" render={({ field }) => (<FormItem><FormLabel>Account Number</FormLabel><FormControl><Input placeholder="Enter bank account number" {...field} /></FormControl><FormMessage /></FormItem>)} />
            <FormField control={form.control} name="ifscCode" render={({ field }) => (<FormItem><FormLabel>IFSC Code</FormLabel><FormControl><Input placeholder="e.g. SBIN0001234" {...field} /></FormControl><FormMessage /></FormItem>)} />
            <FormField control={form.control} name="branchName" render={({ field }) => (<FormItem><FormLabel>Branch Name</FormLabel><FormControl><Input placeholder="e.g. Main Branch, City" {...field} /></FormControl><FormMessage /></FormItem>)} />
          </SectionCard>
          
          <SectionCard title="Document Uploads" description="Upload relevant documents for verification. Max file size 5MB.">
            <FormField
              control={form.control}
              name="profilePicture"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Profile Picture</FormLabel>
                  <FormControl>
                    <Input type="file" accept="image/*" onChange={(e) => field.onChange(e.target.files ? e.target.files[0] : null)} />
                  </FormControl>
                  <FormDescription>Upload a clear passport-size photograph.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="idProof"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ID Proof (Aadhar/PAN/Voter ID)</FormLabel>
                  <FormControl>
                     <Input type="file" accept=".pdf,image/*" onChange={(e) => field.onChange(e.target.files ? e.target.files[0] : null)} />
                  </FormControl>
                   <FormDescription>Upload a scanned copy of your ID proof.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="bankPassbook"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bank Passbook / Cancelled Cheque</FormLabel>
                  <FormControl>
                    <Input type="file" accept=".pdf,image/*" onChange={(e) => field.onChange(e.target.files ? e.target.files[0] : null)} />
                  </FormControl>
                  <FormDescription>Upload first page of passbook or a cancelled cheque.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SectionCard>

          <div className="flex justify-end gap-4 pt-4">
            <Button type="button" variant="outline" onClick={() => form.reset()}>
              Reset Form
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Submitting..." : "Enroll Employee"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
