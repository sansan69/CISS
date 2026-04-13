"use client";

import React, { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';

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
  assignedGuards?: { uid: string; name: string; employeeId: string; gender: string }[];
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
  'Thiruvananthapuram',
  'Kollam',
  'Pathanamthitta',
  'Alappuzha',
  'Kottayam',
  'Idukki',
  'Ernakulam',
  'Thrissur',
  'Palakkad',
  'Malappuram',
  'Kozhikode',
  'Wayanad',
  'Kannur',
  'Kasaragod',
  'Lakshadweep',
];

export function AssignedGuardsExportPanel() {
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
        setOfficers(
          snap.docs.map((d) => ({
            id: d.id,
            name: (d.data() as any).name,
            uid: (d.data() as any).uid,
          })),
        );
      } catch {
        // Intentionally noop; export still works without officer filtering.
      }
    })();
  }, []);

  const buildFiltersDescription = () => {
    const parts: string[] = [];
    if (district !== 'all') parts.push(`District=${district}`);
    if (selectedOfficer !== 'all') {
      parts.push(`Officer=${officers.find((o) => o.uid === selectedOfficer)?.name || selectedOfficer}`);
    }
    if (startDate) parts.push(`From=${startDate}`);
    if (endDate) parts.push(`To=${endDate}`);
    return parts.join(', ') || 'All Data';
  };

  const handleExport = async () => {
    setIsLoading(true);
    try {
      const sitesSnap = await getDocs(collection(db, 'sites'));
      const siteById = new Map<string, SiteDoc>(
        sitesSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .map((site) => [site.id, site as SiteDoc]),
      );

      let workOrdersQuery: any = collection(db, 'workOrders');
      const filters: any[] = [];
      if (district !== 'all') filters.push(where('district', '==', district));
      if (startDate) filters.push(where('date', '>=', Timestamp.fromDate(new Date(`${startDate}T00:00:00`))));
      if (endDate) filters.push(where('date', '<=', Timestamp.fromDate(new Date(`${endDate}T23:59:59`))));
      if (filters.length) workOrdersQuery = query(workOrdersQuery, ...filters);

      const workOrdersSnapshot = await getDocs(workOrdersQuery);
      let workOrders = workOrdersSnapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as WorkOrderDoc[];

      if (selectedOfficer !== 'all') {
        const officer = officers.find((entry) => entry.uid === selectedOfficer);
        if (officer) {
          const officerDoc = (
            await getDocs(query(collection(db, 'fieldOfficers'), where('uid', '==', officer.uid)))
          ).docs[0];
          const assignedDistricts = officerDoc ? (officerDoc.data() as any).assignedDistricts || [] : [];
          workOrders = workOrders.filter((workOrder) => assignedDistricts.includes(workOrder.district));
        }
      }

      const guardIds = Array.from(
        new Set(workOrders.flatMap((workOrder) => (workOrder.assignedGuards || []).map((guard) => guard.uid))),
      );
      const employees: Record<string, EmployeeDoc> = {};

      for (let index = 0; index < guardIds.length; index += 10) {
        const chunk = guardIds.slice(index, index + 10);
        if (!chunk.length) continue;
        const employeeSnapshot = await getDocs(query(collection(db, 'employees'), where('__name__', 'in', chunk)) as any);
        employeeSnapshot.docs.forEach((d) => {
          employees[d.id] = d.data() as any;
        });
      }

      const rows: any[][] = [];
      let serialNumber = 1;
      for (const workOrder of workOrders.sort((a, b) => a.date.toMillis() - b.date.toMillis())) {
        const site = siteById.get(workOrder.siteId);
        const guards = workOrder.assignedGuards || [];
        for (const guard of guards) {
          const employee = employees[guard.uid] || ({} as any);
          rows.push([
            serialNumber++,
            site?.state || 'Kerala',
            workOrder.district || '',
            site?.siteName || workOrder.siteName || '',
            `${site?.siteId || ''}`,
            `${employee.firstName || guard.name?.split(' ')[0] || ''}`,
            `${employee.lastName || guard.name?.split(' ').slice(1).join(' ') || ''}`,
            guard.gender || employee.gender || '',
            employee.dateOfBirth?.toDate ? employee.dateOfBirth.toDate() : employee.dateOfBirth ? new Date(employee.dateOfBirth) : '',
            employee.fatherName || '',
            employee.motherName || '',
            `${employee.fullAddress || ''}`.replace(/\n/g, ', '),
            employee.phoneNumber || '',
            `${employee.emailAddress || ''}`.toLowerCase(),
            employee.resourceIdNumber || '',
            employee.identityProofType || '',
            employee.identityProofNumber || '',
          ]);
        }
      }

      const headers = [
        'Sl No.',
        'State',
        'City',
        'Center Name',
        'Center code',
        'First Name of the employee',
        'Last Name of the employee',
        'male/female',
        'date of birth',
        'father name',
        'mother name',
        'Full address',
        'contact number',
        'email id',
        'Resources ID (If available)',
        'ID Proof Type',
        'ID proof number',
      ];

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const dateOfBirthColumn = headers.indexOf('date of birth');
      if (dateOfBirthColumn >= 0) {
        rows.forEach((row, rowIndex) => {
          const cellAddress = XLSX.utils.encode_cell({ r: rowIndex + 1, c: dateOfBirthColumn });
          const cell = (worksheet as any)[cellAddress];
          if (cell && cell.v instanceof Date) {
            cell.t = 'd';
            cell.z = 'dd-mm-yyyy';
          }
        });
      }

      XLSX.utils.book_append_sheet(workbook, worksheet, 'Assigned Guards');
      const fileName = `Assigned_Guards_${buildFiltersDescription().replace(/[^a-zA-Z0-9_\- ,]/g, '')}.xlsx`;
      XLSX.writeFile(workbook, fileName);
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assigned Guards Export</CardTitle>
        <CardDescription>
          Download the next-day or date-range deployment list for TCS sites with district and field officer filters.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="space-y-1.5">
          <Label>District</Label>
          <Select value={district} onValueChange={setDistrict}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Districts</SelectItem>
              {keralaDistricts.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  {entry}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Field Officer</Label>
          <Select value={selectedOfficer} onValueChange={setSelectedOfficer}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Officers</SelectItem>
              {officers.map((officer) => (
                <SelectItem key={officer.uid} value={officer.uid}>
                  {officer.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>From Date</Label>
          <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>To Date</Label>
          <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={handleExport} disabled={isLoading}>
          {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          {isLoading ? 'Preparing...' : 'Download Excel'}
        </Button>
      </CardFooter>
    </Card>
  );
}
