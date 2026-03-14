"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { format, subDays } from "date-fns";
import { DateRange } from "react-day-picker";
import { BarChart3, CalendarIcon, ChevronLeft, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { KERALA_DISTRICTS } from "@/lib/constants";
import { authorizedFetch } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";

type AttendanceReportRow = {
  employeeName: string;
  employeeId: string;
  status: string;
  clientName: string;
  district: string;
  siteName: string;
  locationText: string;
  createdAt: string;
};

function downloadBlob(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [status, setStatus] = useState("all");
  const [district, setDistrict] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 7),
    to: new Date(),
  });
  const [rows, setRows] = useState<AttendanceReportRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const { toast } = useToast();

  const summary = useMemo(() => {
    const total = rows.length;
    const inCount = rows.filter((row) => row.status === "In").length;
    const outCount = rows.filter((row) => row.status === "Out").length;
    const uniqueEmployees = new Set(rows.map((row) => row.employeeId)).size;
    return { total, inCount, outCount, uniqueEmployees };
  }, [rows]);

  const buildParams = () => {
    const params = new URLSearchParams({
      status,
      district,
      format: "json",
    });

    if (dateRange?.from) {
      params.set("from", dateRange.from.toISOString());
    }
    if (dateRange?.to) {
      params.set("to", dateRange.to.toISOString());
    }

    return params;
  };

  const handleGenerate = async () => {
    try {
      setIsLoading(true);
      const response = await authorizedFetch(`/api/admin/reports/attendance?${buildParams().toString()}`);
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Could not generate the attendance report.");
      }

      setRows(data.rows || []);
      setHasGenerated(true);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Report generation failed",
        description: error.message || "Could not load attendance report data.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async () => {
    try {
      setIsLoading(true);
      const params = buildParams();
      params.set("format", "csv");
      const response = await authorizedFetch(`/api/admin/reports/attendance?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Could not download the report.");
      }

      const csv = await response.text();
      downloadBlob(csv, "attendance-report.csv", "text/csv;charset=utf-8");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Download failed",
        description: error.message || "Could not download the report.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/settings">
            <ChevronLeft className="h-4 w-4" />
            <span className="sr-only">Back to Settings</span>
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Attendance Reports</h1>
          <p className="text-muted-foreground">Generate filtered attendance summaries and download them as CSV.</p>
        </div>
      </div>

      <Alert>
        <BarChart3 className="h-4 w-4" />
        <AlertTitle>Server-backed reporting</AlertTitle>
        <AlertDescription>
          Reports are generated through authenticated server routes now, so admin exports no longer depend on client-side Firestore writes.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Report filters</CardTitle>
          <CardDescription>Choose a date window and optionally narrow the report by status or district.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Date range</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange?.from
                    ? `${format(dateRange.from, "dd MMM yyyy")}${dateRange.to ? ` - ${format(dateRange.to, "dd MMM yyyy")}` : ""}`
                    : "Pick a date range"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={dateRange?.from}
                  selected={dateRange}
                  onSelect={setDateRange}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="In">IN only</SelectItem>
                <SelectItem value="Out">OUT only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>District</Label>
            <Select value={district} onValueChange={setDistrict}>
              <SelectTrigger>
                <SelectValue placeholder="All districts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All districts</SelectItem>
                {KERALA_DISTRICTS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <Button onClick={handleGenerate} disabled={isLoading}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Generate report
          </Button>
          <Button variant="outline" onClick={handleDownload} disabled={isLoading || !hasGenerated}>
            <Download className="mr-2 h-4 w-4" />
            Download CSV
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total records</CardDescription>
            <CardTitle>{summary.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>IN marks</CardDescription>
            <CardTitle>{summary.inCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>OUT marks</CardDescription>
            <CardTitle>{summary.outCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Unique employees</CardDescription>
            <CardTitle>{summary.uniqueEmployees}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>
            {hasGenerated ? "Preview of the generated report." : "Generate a report to preview the first rows."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!hasGenerated ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
              No report has been generated yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>District</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, 20).map((row) => (
                  <TableRow key={`${row.employeeId}-${row.createdAt}`}>
                    <TableCell>
                      <div className="font-medium">{row.employeeName}</div>
                      <div className="text-xs text-muted-foreground">{row.employeeId}</div>
                    </TableCell>
                    <TableCell>{row.createdAt ? format(new Date(row.createdAt), "dd MMM yyyy, hh:mm a") : "N/A"}</TableCell>
                    <TableCell>{row.status}</TableCell>
                    <TableCell>
                      <div>{row.siteName || "Unknown site"}</div>
                      <div className="text-xs text-muted-foreground">{row.clientName || "Unknown client"}</div>
                    </TableCell>
                    <TableCell>{row.district || "N/A"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
