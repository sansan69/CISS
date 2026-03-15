"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { format, subDays } from "date-fns";
import { DateRange } from "react-day-picker";
import { BarChart3, CalendarIcon, ChevronLeft, Download, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
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
  const [preset, setPreset] = useState<"today" | "last7" | "last30" | "custom">("last7");
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

  const activeFilters = useMemo(() => {
    const filters: string[] = [];
    if (status !== "all") filters.push(`${status} marks`);
    if (district !== "all") filters.push(district);
    return filters;
  }, [district, status]);

  const applyPreset = (nextPreset: "today" | "last7" | "last30" | "custom") => {
    const now = new Date();
    setPreset(nextPreset);
    if (nextPreset === "today") {
      setDateRange({ from: now, to: now });
      return;
    }
    if (nextPreset === "last7") {
      setDateRange({ from: subDays(now, 7), to: now });
      return;
    }
    if (nextPreset === "last30") {
      setDateRange({ from: subDays(now, 30), to: now });
    }
  };

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
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button variant="outline" size="sm" asChild className="w-full sm:w-auto">
          <Link href="/settings">
            <ChevronLeft className="mr-2 h-4 w-4" />
            <span>Back to Settings</span>
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Attendance Reports</h1>
          <p className="text-muted-foreground">Pick a time period, optionally refine it, and export without digging through too many controls.</p>
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
          <CardTitle>Quick report</CardTitle>
          <CardDescription>Start with a common time window. Open advanced filters only if you need to narrow the export.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Button variant={preset === "today" ? "default" : "outline"} onClick={() => applyPreset("today")} className="w-full">
              Today
            </Button>
            <Button variant={preset === "last7" ? "default" : "outline"} onClick={() => applyPreset("last7")} className="w-full">
              Last 7 Days
            </Button>
            <Button variant={preset === "last30" ? "default" : "outline"} onClick={() => applyPreset("last30")} className="w-full">
              Last 30 Days
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant={preset === "custom" ? "default" : "outline"} className="w-full justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange?.from
                    ? `${format(dateRange.from, "dd MMM yyyy")}${dateRange.to ? ` - ${format(dateRange.to, "dd MMM yyyy")}` : ""}`
                    : "Custom range"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={dateRange?.from}
                  selected={dateRange}
                  onSelect={(range) => {
                    setPreset("custom");
                    setDateRange(range);
                  }}
                  numberOfMonths={1}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              {dateRange?.from
                ? `${format(dateRange.from, "dd MMM")} to ${format(dateRange.to || dateRange.from, "dd MMM yyyy")}`
                : "No period selected"}
            </Badge>
            {activeFilters.length > 0 ? (
              activeFilters.map((filter) => (
                <Badge key={filter} variant="outline">{filter}</Badge>
              ))
            ) : (
              <Badge variant="outline">All statuses and districts</Badge>
            )}
          </div>

          <Accordion type="single" collapsible className="rounded-lg border px-4">
            <AccordionItem value="advanced" className="border-b-0">
              <AccordionTrigger className="py-3 text-sm font-medium hover:no-underline">
                Advanced filters
              </AccordionTrigger>
              <AccordionContent className="pt-1">
                <div className="grid gap-4 md:grid-cols-2">
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
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <div className="grid gap-3 sm:grid-cols-2">
            <Button onClick={handleGenerate} disabled={isLoading} className="w-full">
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Generate Preview
            </Button>
            <Button variant="outline" onClick={handleDownload} disabled={isLoading} className="w-full">
            <Download className="mr-2 h-4 w-4" />
            Download CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
            <>
              <div className="grid gap-3 md:hidden">
                {rows.slice(0, 20).map((row) => (
                  <div key={`${row.employeeId}-${row.createdAt}`} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium break-words">{row.employeeName}</p>
                        <p className="text-xs text-muted-foreground break-all">{row.employeeId}</p>
                      </div>
                      <Badge variant={row.status === "In" ? "default" : "secondary"}>{row.status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Time</p>
                        <p>{row.createdAt ? format(new Date(row.createdAt), "dd MMM yyyy, hh:mm a") : "N/A"}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Site</p>
                        <p>{row.siteName || "Unknown site"}</p>
                        <p className="text-xs text-muted-foreground">{row.clientName || "Unknown client"}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">District</p>
                        <p>{row.district || "N/A"}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden md:block">
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
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
