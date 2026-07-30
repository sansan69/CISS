"use client";

import React, { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, SpinnerGap as Loader2 } from '@phosphor-icons/react';
import { OPERATIONAL_CLIENT_NAME } from '@/lib/constants';
import { authorizedFetch } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';

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
  const { toast } = useToast();
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
      } catch (error) {
        console.error('Could not load field officers for export:', error);
        toast({
          variant: 'destructive',
          title: 'Officer filter unavailable',
          description: 'You can still export by district and date.',
        });
      }
    })();
  }, [toast]);

  const handleExport = async () => {
    setIsLoading(true);
    try {
      if (startDate && endDate && startDate > endDate) {
        throw new Error('The From Date must be on or before the To Date.');
      }

      const params = new URLSearchParams();
      if (district !== 'all') params.set('district', district);
      if (selectedOfficer !== 'all') params.set('officerUid', selectedOfficer);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const response = await authorizedFetch(
        `/api/admin/work-orders/assigned-guards-export?${params.toString()}`,
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || 'Could not prepare the assigned guard export.');
      }

      const blob = await response.blob();
      if (blob.size === 0) {
        throw new Error('The generated Excel file was empty.');
      }
      const disposition = response.headers.get('content-disposition') || '';
      const fileNameMatch = disposition.match(/filename="?([^";]+)"?/i);
      const fileName = fileNameMatch?.[1] || 'Assigned_Guards.xlsx';
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);

      const rowCount = Number(response.headers.get('x-export-row-count') || 0);
      toast({
        title: 'Download started',
        description: rowCount > 0
          ? `${rowCount.toLocaleString()} assigned guard record${rowCount === 1 ? '' : 's'} exported.`
          : 'The assigned guard workbook is downloading.',
      });
    } catch (error) {
      console.error('Export failed:', error);
      toast({
        variant: 'destructive',
        title: 'Download failed',
        description: error instanceof Error ? error.message : 'Could not download assigned guard data.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assigned Guards Export</CardTitle>
        <CardDescription>
          Download the next-day or date-range deployment list for {OPERATIONAL_CLIENT_NAME} sites with district and field officer filters.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="assigned-guards-district">District</Label>
          <Select value={district} onValueChange={setDistrict}>
            <SelectTrigger id="assigned-guards-district">
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
          <Label htmlFor="assigned-guards-officer">Field Officer</Label>
          <Select value={selectedOfficer} onValueChange={setSelectedOfficer}>
            <SelectTrigger id="assigned-guards-officer">
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
          <Label htmlFor="assigned-guards-from-date">From Date</Label>
          <Input id="assigned-guards-from-date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="assigned-guards-to-date">To Date</Label>
          <Input id="assigned-guards-to-date" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
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
