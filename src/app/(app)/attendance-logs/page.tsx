"use client";

import React, { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileDown, Search } from "lucide-react";
import { format } from "date-fns";
import { KERALA_DISTRICTS } from "@/lib/constants";
import { authorizedFetch } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import type { AttendancePhotoCompliance } from "@/types/attendance";
import { PageHeader } from "@/components/layout/page-header";

type AttendanceLog = {
  id: string;
  employeeId: string;
  employeeName: string;
  status: "In" | "Out";
  district?: string;
  clientName?: string;
  siteName?: string;
  sourceCollection?: string;
  locationText?: string;
  gpsAccuracyMeters?: number | null;
  geofenceRadiusAtTime?: number | null;
  isMockLocationSuspected?: boolean;
  requiresLocationReview?: boolean;
  photoUrl?: string;
  photoCompliance?: AttendancePhotoCompliance | null;
  reportedAtClient?: string | null;
  reportedAt?: Timestamp;
  createdAt?: Timestamp;
};

function getReportedAt(log: AttendanceLog) {
  if (log.reportedAt?.toDate) return log.reportedAt.toDate();
  if (log.reportedAtClient) {
    const parsed = new Date(log.reportedAtClient);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return log.createdAt?.toDate ? log.createdAt.toDate() : null;
}

function downloadBlob(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function AttendanceLogsPage() {
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [districtFilter, setDistrictFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const logsQuery = query(
      collection(db, "attendanceLogs"),
      orderBy("createdAt", "desc"),
      limit(200)
    );

    const unsubscribe = onSnapshot(
      logsQuery,
      (snapshot) => {
        setLogs(
          snapshot.docs.map((docSnapshot) => ({
            id: docSnapshot.id,
            ...(docSnapshot.data() as Omit<AttendanceLog, "id">),
          }))
        );
        setIsLoading(false);
      },
      () => setIsLoading(false)
    );

    return () => unsubscribe();
  }, []);

  const clientOptions = useMemo(() => {
    const names = new Set<string>();
    for (const log of logs) {
      if (log.clientName) names.add(log.clientName);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return logs.filter((log) => {
      const matchesStatus = statusFilter === "all" || log.status === statusFilter;
      const matchesDistrict = districtFilter === "all" || log.district === districtFilter;
      const matchesClient = clientFilter === "all" || log.clientName === clientFilter;
      const matchesSearch =
        !term ||
        log.employeeName?.toLowerCase().includes(term) ||
        log.employeeId?.toLowerCase().includes(term) ||
        log.siteName?.toLowerCase().includes(term) ||
        log.clientName?.toLowerCase().includes(term);

      return matchesStatus && matchesDistrict && matchesClient && matchesSearch;
    });
  }, [clientFilter, districtFilter, logs, searchTerm, statusFilter]);

  const totals = useMemo(() => {
    const inCount = filteredLogs.filter((log) => log.status === "In").length;
    const outCount = filteredLogs.filter((log) => log.status === "Out").length;
    const uniqueEmployees = new Set(filteredLogs.map((log) => log.employeeId)).size;
    return { total: filteredLogs.length, inCount, outCount, uniqueEmployees };
  }, [filteredLogs]);

  const handleExport = async () => {
    try {
      setIsExporting(true);
      const params = new URLSearchParams({
        format: "csv",
        status: statusFilter,
        district: districtFilter,
      });

      const response = await authorizedFetch(`/api/admin/reports/attendance?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Could not export the current attendance view.");
      }

      const csv = await response.text();
      downloadBlob(csv, "attendance-logs.csv", "text/csv;charset=utf-8");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: error.message || "Could not export attendance logs.",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <PageHeader
        eyebrow="Workforce"
        title="Attendance Logs"
        description="Live attendance activity from the latest 200 records."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Attendance Logs" },
        ]}
        actions={
          <Button onClick={handleExport} disabled={isExporting} className="w-full sm:w-auto">
          {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
          Export CSV
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total records</CardDescription>
            <CardTitle>{totals.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>IN marks</CardDescription>
            <CardTitle>{totals.inCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>OUT marks</CardDescription>
            <CardTitle>{totals.outCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Unique employees</CardDescription>
            <CardTitle>{totals.uniqueEmployees}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Search by employee, site, or client and narrow the live log stream.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search logs"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="In">IN only</SelectItem>
              <SelectItem value="Out">OUT only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={districtFilter} onValueChange={setDistrictFilter}>
            <SelectTrigger>
              <SelectValue placeholder="District" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All districts</SelectItem>
              {KERALA_DISTRICTS.map((district) => (
                <SelectItem key={district} value={district}>
                  {district}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Client" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {clientOptions.map((client) => (
                <SelectItem key={client} value={client}>
                  {client}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>The list updates automatically as new attendance records arrive.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {filteredLogs.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
                  No attendance records match the current filters.
                </div>
              ) : (
                <>
                  <div className="grid gap-3 md:hidden">
                    {filteredLogs.map((log) => (
                      <div key={log.id} className="rounded-lg border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium break-words">{log.employeeName || "Unknown employee"}</p>
                            <p className="text-xs text-muted-foreground break-all">{log.employeeId}</p>
                          </div>
                          <Badge variant={log.status === "In" ? "default" : "secondary"}>{log.status}</Badge>
                        </div>
                        <div className="mt-3 grid gap-2 text-sm">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Reported at</p>
                            <p>{getReportedAt(log) ? format(getReportedAt(log)!, "dd MMM yyyy, hh:mm a") : "Pending"}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Site</p>
                            <p className="flex items-center gap-1">
                              {log.siteName || "Unknown site"}
                              {log.sourceCollection === "clientLocations" && (
                                <span className="text-[10px] bg-muted rounded px-1 py-0.5 font-medium">Office</span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">{log.clientName || "Unknown client"}</p>
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">District</p>
                            <p>{log.district || "N/A"}</p>
                          </div>
                          {log.photoCompliance && (
                            <div>
                              <p className="text-xs uppercase tracking-wide text-muted-foreground">Uniform review</p>
                              <div className="mt-1 flex flex-wrap gap-2">
                                <Badge
                                  variant={
                                    log.photoCompliance.overallStatus === "clear"
                                      ? "outline"
                                      : "destructive"
                                  }
                                >
                                  {log.photoCompliance.overallStatus === "clear"
                                    ? "Clear"
                                    : log.photoCompliance.overallStatus === "warning"
                                      ? "Review required"
                                      : "AI check unavailable"}
                                </Badge>
                                {log.photoCompliance.adminFlag && (
                                  <Badge variant="secondary">Admin flag</Badge>
                                )}
                                {log.requiresLocationReview && (
                                  <Badge variant="secondary">Location review</Badge>
                                )}
                                {log.isMockLocationSuspected && (
                                  <Badge variant="destructive">Mock location suspected</Badge>
                                )}
                              </div>
                              {log.photoCompliance.warnings.length > 0 && (
                                <p className="mt-2 text-sm text-muted-foreground">
                                  {log.photoCompliance.warnings.join(" • ")}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="hidden md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Employee</TableHead>
                          <TableHead>Reported at</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Site</TableHead>
                          <TableHead>District</TableHead>
                          <TableHead>Uniform review</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredLogs.map((log) => (
                          <TableRow key={log.id}>
                            <TableCell>
                              <div className="font-medium">{log.employeeName || "Unknown employee"}</div>
                              <div className="text-xs text-muted-foreground">{log.employeeId}</div>
                            </TableCell>
                            <TableCell>
                              {getReportedAt(log) ? format(getReportedAt(log)!, "dd MMM yyyy, hh:mm a") : "Pending"}
                            </TableCell>
                            <TableCell>
                              <Badge variant={log.status === "In" ? "default" : "secondary"}>{log.status}</Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                {log.siteName || "Unknown site"}
                                {log.sourceCollection === "clientLocations" && (
                                  <span className="text-[10px] bg-muted rounded px-1 py-0.5 font-medium">Office</span>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground">{log.clientName || "Unknown client"}</div>
                            </TableCell>
                            <TableCell>{log.district || "N/A"}</TableCell>
                            <TableCell>
                              {log.photoCompliance ? (
                                <div className="space-y-1">
                                  <div className="flex flex-wrap gap-2">
                                    <Badge
                                      variant={
                                        log.photoCompliance.overallStatus === "clear"
                                          ? "outline"
                                          : "destructive"
                                      }
                                    >
                                      {log.photoCompliance.overallStatus === "clear"
                                        ? "Clear"
                                        : log.photoCompliance.overallStatus === "warning"
                                          ? "Review required"
                                          : "AI check unavailable"}
                                    </Badge>
                                    {log.photoCompliance.adminFlag && (
                                      <Badge variant="secondary">Admin flag</Badge>
                                    )}
                                    {log.requiresLocationReview && (
                                      <Badge variant="secondary">Location review</Badge>
                                    )}
                                    {log.isMockLocationSuspected && (
                                      <Badge variant="destructive">Mock location suspected</Badge>
                                    )}
                                  </div>
                                  {log.photoCompliance.warnings.length > 0 && (
                                    <div className="text-xs text-muted-foreground">
                                      {log.photoCompliance.warnings.join(" • ")}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted-foreground">Not reviewed</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
