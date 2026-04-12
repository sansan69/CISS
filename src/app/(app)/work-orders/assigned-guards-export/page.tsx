"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, orderBy, Timestamp } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Loader2, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { PageHeader } from '@/components/layout/page-header';

interface SiteDoc {
    id: string;
    siteName: string;
    siteId?: string | null;
    clientName: string;
    district: string;
    state?: string;
}

interface WorkOrderDoc {
    id: string;
    siteId: string;
    siteName: string;
    clientName: string;
    district: string;
    date: Timestamp;
    assignedGuards?: { uid: string; name: string; employeeId: string; gender: string; }[];
}

interface EmployeeDoc {
    id: string;
    firstName: string;
    lastName: string;
    gender: string;
    dateOfBirth?: any;
    fatherName?: string;
    motherName?: string;
    fullAddress?: string;
    phoneNumber?: string;
    emailAddress?: string;
    resourceIdNumber?: string;
    identityProofType?: string;
    identityProofNumber?: string;
}

const keralaDistricts = [
    "Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha",
    "Kottayam", "Idukki", "Ernakulam", "Thrissur", "Palakkad",
    "Malappuram", "Kozhikode", "Wayanad", "Kannur", "Kasaragod", "Lakshadweep"
];

export default function AssignedGuardsExportPage() {
    const [district, setDistrict] = useState<string>('all');
    const [officers, setOfficers] = useState<{ id: string; name: string; uid: string }[]>([]);
    const [selectedOfficer, setSelectedOfficer] = useState<string>('all');
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const snap = await getDocs(collection(db, 'fieldOfficers'));
                setOfficers(snap.docs.map(d => ({ id: d.id, name: (d.data() as any).name, uid: (d.data() as any).uid })));
            } catch {}
        })();
    }, []);

    const buildFiltersDescription = () => {
        const parts: string[] = [];
        if (district !== 'all') parts.push(`District=${district}`);
        if (selectedOfficer !== 'all') parts.push(`Officer=${officers.find(o=>o.uid===selectedOfficer)?.name || selectedOfficer}`);
        if (startDate) parts.push(`From=${startDate}`);
        if (endDate) parts.push(`To=${endDate}`);
        return parts.join(', ') || 'All Data';
    };

    const handleExport = async () => {
        setIsLoading(true);
        try {
            const sitesSnap = await getDocs(collection(db, 'sites'));
            const siteById = new Map<string, SiteDoc>(sitesSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })).map(s => [s.id, s as SiteDoc]));

            let wq: any = collection(db, 'workOrders');
            const filters: any[] = [];
            if (district !== 'all') filters.push(where('district', '==', district));
            if (startDate) filters.push(where('date', '>=', Timestamp.fromDate(new Date(startDate + 'T00:00:00'))));
            if (endDate) filters.push(where('date', '<=', Timestamp.fromDate(new Date(endDate + 'T23:59:59'))));
            if (filters.length) wq = query(wq, ...filters);
            const woSnap = await getDocs(wq);
            let workOrders: WorkOrderDoc[] = woSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as any;

            if (selectedOfficer !== 'all') {
                const officer = officers.find(o => o.uid === selectedOfficer);
                if (officer) {
                    const officerDoc = (await getDocs(query(collection(db,'fieldOfficers'), where('uid','==', officer.uid)))).docs[0];
                    const assigned = officerDoc ? (officerDoc.data() as any).assignedDistricts || [] : [];
                    workOrders = workOrders.filter(w => assigned.includes(w.district));
                }
            }

            const guardIds = Array.from(new Set(workOrders.flatMap(w => (w.assignedGuards || []).map(g => g.uid))));
            const employees: Record<string, EmployeeDoc> = {};
            for (let i = 0; i < guardIds.length; i += 10) {
                const chunk = guardIds.slice(i, i + 10);
                if (chunk.length === 0) continue;
                const snap = await getDocs(query(collection(db, 'employees'), where('__name__', 'in', chunk)) as any);
                snap.docs.forEach(d => { employees[d.id] = d.data() as any; });
            }

            const rows: any[][] = [];
            let sl = 1;
            for (const w of workOrders.sort((a,b)=>a.date.toMillis()-b.date.toMillis())) {
                const site = siteById.get(w.siteId);
                const guards = (w.assignedGuards || []);
                for (const g of guards) {
                    const emp = employees[g.uid] || {} as any;
                    rows.push([
                        sl++,
                        site?.state || 'Kerala',
                        w.district || '',
                        site?.siteName || w.siteName || '',
                        (site?.siteId || '') + '',
                        (emp.firstName || (g.name?.split(' ')[0] || '')).toString(),
                        (emp.lastName || (g.name?.split(' ').slice(1).join(' ') || '')).toString(),
                        (g.gender || emp.gender || ''),
                        emp.dateOfBirth?.toDate ? emp.dateOfBirth.toDate() : (emp.dateOfBirth ? new Date(emp.dateOfBirth) : ''),
                        emp.fatherName || '',
                        emp.motherName || '',
                        (emp.fullAddress || '').toString().replace(/\n/g, ', '),
                        emp.phoneNumber || '',
                        (emp.emailAddress || '').toLowerCase(),
                        emp.resourceIdNumber || '',
                        emp.identityProofType || '',
                        emp.identityProofNumber || '',
                    ]);
                }
            }

            const headers = [
                'Sl No.', 'State', 'City', 'Center Name', 'Center code',
                'First Name of the employee', 'Last Name of the employee',
                'male/female', 'date of birth', 'father name', 'mother name',
                'Full address', 'contact number', 'email id',
                'Resources ID (If available)', 'ID Proof Type', 'ID proof number'
            ];

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
            const dobCol = headers.indexOf('date of birth');
            if (dobCol >= 0) {
                rows.forEach((r, i) => {
                    const cellAddr = XLSX.utils.encode_cell({ r: i + 1, c: dobCol });
                    const cell = (ws as any)[cellAddr];
                    if (cell && cell.v instanceof Date) {
                        cell.t = 'd';
                        cell.z = 'dd-mm-yyyy';
                    }
                });
            }
            XLSX.utils.book_append_sheet(wb, ws, 'Assigned Guards');
            const fileName = `Assigned_Guards_${buildFiltersDescription().replace(/[^a-zA-Z0-9_\- ,]/g,'')}.xlsx`;
            XLSX.writeFile(wb, fileName);
        } catch (e) {
            console.error('Export failed:', e);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <PageHeader
                eyebrow="Work Orders"
                title="Assigned Guards Export"
                description="Download guard assignment details with officer, district, and date filters."
                breadcrumbs={[
                    { label: "Dashboard", href: "/dashboard" },
                    { label: "Work Orders", href: "/work-orders" },
                    { label: "Assigned Guards Export" },
                ]}
            />
            <Card>
                <CardHeader>
                    <CardTitle>Filters</CardTitle>
                    <CardDescription>Select filters to narrow down the export.</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="space-y-1.5">
                        <Label>District</Label>
                        <Select value={district} onValueChange={setDistrict}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Districts</SelectItem>
                                {keralaDistricts.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Field Officer</Label>
                        <Select value={selectedOfficer} onValueChange={setSelectedOfficer}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Officers</SelectItem>
                                {officers.map(o => <SelectItem key={o.uid} value={o.uid}>{o.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label>From Date</Label>
                        <Input type="date" value={startDate} onChange={(e)=>setStartDate(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                        <Label>To Date</Label>
                        <Input type="date" value={endDate} onChange={(e)=>setEndDate(e.target.value)} />
                    </div>
                </CardContent>
                <CardFooter>
                    <Button onClick={handleExport} disabled={isLoading}>
                        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Download className="mr-2 h-4 w-4"/>}
                        {isLoading ? 'Preparing...' : 'Download Excel'}
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
}
