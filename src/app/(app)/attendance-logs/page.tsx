
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ListFilter, FileDown, Loader2, AlertCircle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import React, { useState } from 'react';

// This is a placeholder page for the admin view of attendance logs.
// We will build this out later with features like filtering, searching, and exporting reports.

const mockLogs = [
    { id: '1', name: 'Aarav Sharma', employeeId: 'TCS/24-25/001', time: '09:02 AM', status: 'In', location: 'TCS Technopark', photoUrl: 'https://placehold.co/40x40.png' },
    { id: '2', name: 'Isha Verma', employeeId: 'WIPRO/23-24/102', time: '09:05 AM', status: 'In', location: 'Wipro Infopark', photoUrl: 'https://placehold.co/40x40.png' },
    { id: '3', name: 'Rohan Nair', employeeId: 'INFOSYS/24-25/033', time: '08:55 AM', status: 'In', location: 'Infosys Campus', photoUrl: 'https://placehold.co/40x40.png' },
    { id: '4', name: 'Priya Menon', employeeId: 'TCS/23-24/214', time: '09:15 AM', status: 'In', location: 'TCS Technopark', photoUrl: 'https://placehold.co/40x40.png' },
    { id: '5', name: 'Aarav Sharma', employeeId: 'TCS/24-25/001', time: '06:05 PM', status: 'Out', location: 'TCS Technopark', photoUrl: 'https://placehold.co/40x40.png' },
];


export default function AttendanceLogsPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);

  // In a real app, this would be fetched from Firestore
  const logs = mockLogs;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
         <div>
            <h1 className="text-3xl font-bold tracking-tight">Attendance Logs</h1>
            <p className="text-muted-foreground">View all employee check-ins and check-outs.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline">
            <ListFilter className="mr-2 h-4 w-4" />
            Filter
          </Button>
          <Button>
            <FileDown className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>All Attendance Records</CardTitle>
          <CardDescription>
            A live feed of attendance records from all locations.
          </CardDescription>
        </CardHeader>
        <CardContent>
            {isLoading ? (
                <div className="flex justify-center items-center h-48"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>
            ) : error ? (
                <div className="text-center py-10 text-destructive"><AlertCircle className="mx-auto h-12 w-12" /><p className="mt-4 text-lg">{error}</p></div>
            ) : (
                 <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Employee</TableHead>
                            <TableHead>Time</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Location / Details</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {logs.length === 0 ? (
                            <TableRow><TableCell colSpan={4} className="h-24 text-center">No attendance records found.</TableCell></TableRow>
                        ) : (
                            logs.map((log) => (
                                <TableRow key={log.id}>
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                            <Avatar>
                                                <AvatarImage src={log.photoUrl} alt={log.name} />
                                                <AvatarFallback>{log.name.split(' ').map(n=>n[0]).join('')}</AvatarFallback>
                                            </Avatar>
                                            <div>
                                                <div className="font-medium">{log.name}</div>
                                                <div className="text-sm text-muted-foreground">{log.employeeId}</div>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell>{log.time}</TableCell>
                                    <TableCell>
                                        <Badge variant={log.status === 'In' ? 'default' : 'destructive'}>{log.status}</Badge>
                                    </TableCell>
                                    <TableCell>{log.location}</TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                 </Table>
            )}
        </CardContent>
        <CardFooter>
            <div className="text-xs text-muted-foreground">Showing the last <strong>{logs.length}</strong> records.</div>
        </CardFooter>
      </Card>
    </div>
  );
}

    