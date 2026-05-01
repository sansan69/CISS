"use client";

import Image from "next/image";
import React, { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileDown, Search, MapPin, Clock, Smartphone, ShieldAlert, Image as ImageIcon, ChevronRight, ChevronDown } from "lucide-react";
import { format } from "date-fns";
import { authorizedFetch } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import type { AttendancePhotoCompliance } from "@/types/attendance";
import { PageHeader } from "@/components/layout/page-header";
import { useAppAuth } from "@/context/auth-context";
import {
  districtMatches,
  getDefaultDistrictSuggestions,
  mergeDistrictOptions,
} from "@/lib/districts";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { ChevronUp } from "lucide-react";

type AttendanceLog = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeePhoneNumber?: string;
  status: "In" | "Out";
  district?: string;
  clientName?: string;
  siteName?: string;
  dutyPointName?: string;
  siteId?: string;
  sourceCollection?: string;
  locationText?: string;
  locationCoords?: { lat: number; lon: number; accuracyMeters?: number };
  siteCoords?: { lat: number; lng: number };
  distanceMeters?: number;
  gpsAccuracyMeters?: number | null;
  locationAccuracyMeters?: number | null;
  geofenceRadiusAtTime?: number | null;
  isMockLocationSuspected?: boolean;
  mockLocationReason?: string | null;
  requiresLocationReview?: boolean;
  shiftCode?: string;
  shiftLabel?: string;
  shiftStartTime?: string;
  shiftEndTime?: string;
  photoUrl?: string;
  photoCapturedAt?: string;
  photoCompliance?: AttendancePhotoCompliance | null;
  deviceInfo?: { userAgent: string };
  reportedAtClient?: string | null;
  reportedAt?: Timestamp;
  serverProcessedAt?: Timestamp;
  clockDriftMinutes?: number;
  clockDriftWarning?: string | null;
  requiresAdminReview?: boolean;
  createdAt?: Timestamp;
  attendanceDate?: string;
};

function getReportedAt(log: AttendanceLog) {
  if (log.reportedAt?.toDate) return log.reportedAt.toDate();
  if (log.reportedAtClient) {
    const parsed = new Date(log.reportedAtClient);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (log.serverProcessedAt?.toDate) return log.serverProcessedAt.toDate();
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
  const { userRole, assignedDistricts, clientInfo, stateCode } = useAppAuth();
  const isClientView = userRole === "client";
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [districtFilter, setDistrictFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AttendanceLog | null>(null);
  const [allExpanded, setAllExpanded] = useState(false);
  const [expandedValues, setExpandedValues] = useState<string[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    // Wait for auth to resolve before subscribing
    if (userRole === null) return;

    let logsQuery;
    if (userRole === "client") {
      if (!clientInfo?.clientName) {
        setIsLoading(false);
        return;
      }
      logsQuery = query(
        collection(db, "attendanceLogs"),
        where("clientName", "==", clientInfo.clientName),
        orderBy("createdAt", "desc"),
        limit(200)
      );
    } else if (userRole === "fieldOfficer") {
      if (!assignedDistricts.length) {
        setIsLoading(false);
        return;
      }
      logsQuery = query(
        collection(db, "attendanceLogs"),
        where("district", "in", assignedDistricts),
        orderBy("createdAt", "desc"),
        limit(200)
      );
    } else {
      logsQuery = query(
        collection(db, "attendanceLogs"),
        orderBy("createdAt", "desc"),
        limit(200)
      );
    }

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
  }, [userRole, clientInfo, assignedDistricts]);

  const clientOptions = useMemo(() => {
    const names = new Set<string>();
    for (const log of logs) {
      if (log.clientName) names.add(log.clientName);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [logs]);

  const districtOptions = useMemo(
    () =>
      mergeDistrictOptions(
        getDefaultDistrictSuggestions(stateCode),
        logs.map((log) => log.district),
        assignedDistricts,
      ),
    [assignedDistricts, logs, stateCode],
  );

  const filteredLogs = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return logs.filter((log) => {
      const matchesRole =
        userRole === "fieldOfficer"
          ? assignedDistricts.some((district) => districtMatches(district, log.district))
          : userRole === "client"
            ? !clientInfo?.clientName || log.clientName === clientInfo.clientName
            : true;
      const matchesStatus = statusFilter === "all" || log.status === statusFilter;
      const matchesDistrict =
        districtFilter === "all" || districtMatches(log.district, districtFilter);
      const matchesClient = clientFilter === "all" || log.clientName === clientFilter;
      const matchesSearch =
        !term ||
        log.employeeName?.toLowerCase().includes(term) ||
        log.employeeId?.toLowerCase().includes(term) ||
        log.siteName?.toLowerCase().includes(term) ||
        log.dutyPointName?.toLowerCase().includes(term) ||
        log.clientName?.toLowerCase().includes(term);

      return matchesRole && matchesStatus && matchesDistrict && matchesClient && matchesSearch;
    });
  }, [assignedDistricts, clientFilter, clientInfo?.clientName, districtFilter, logs, searchTerm, statusFilter, userRole]);

  const totals = useMemo(() => {
    const inCount = filteredLogs.filter((log) => log.status === "In").length;
    const outCount = filteredLogs.filter((log) => log.status === "Out").length;
    const uniqueEmployees = new Set(filteredLogs.map((log) => log.employeeId)).size;
    return { total: filteredLogs.length, inCount, outCount, uniqueEmployees };
  }, [filteredLogs]);

  const groupedLogs = useMemo(() => {
    const dateMap = new Map<string, Map<string, AttendanceLog[]>>();
    for (const log of filteredLogs) {
      const date = log.attendanceDate || "Unknown";
      const client = log.clientName || "Unknown client";
      let clientMap = dateMap.get(date);
      if (!clientMap) {
        clientMap = new Map();
        dateMap.set(date, clientMap);
      }
      const list = clientMap.get(client) || [];
      list.push(log);
      clientMap.set(client, list);
    }
    return Array.from(dateMap.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, clientMap]) => {
        const clients = Array.from(clientMap.entries())
          .sort(([a], [b]) => a.localeCompare(b));
        return [date, clients] as const;
      });
  }, [filteredLogs]);

  const allDateKeys = useMemo(() => groupedLogs.map(([date]) => date), [groupedLogs]);

  const handleExpandAll = () => {
    setAllExpanded(true);
    const allKeys: string[] = [];
    for (const [date, clients] of groupedLogs) {
      allKeys.push(date);
      if (!isClientView) {
        for (const [client] of clients) {
          allKeys.push(`${date}||${client}`);
        }
      }
    }
    setExpandedValues(allKeys);
  };

  const handleCollapseAll = () => {
    setAllExpanded(false);
    const firstDate = groupedLogs[0]?.[0];
    if (!firstDate) {
      setExpandedValues([]);
      return;
    }
    const keys: string[] = [firstDate];
    if (!isClientView) {
      const firstDateClients = groupedLogs[0]?.[1] ?? [];
      for (const [client] of firstDateClients) {
        keys.push(`${firstDate}||${client}`);
      }
    }
    setExpandedValues(keys);
  };

  useEffect(() => {
    if (allDateKeys.length === 0) {
      setExpandedValues([]);
      return;
    }
    handleCollapseAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const renderLogList = (logs: AttendanceLog[]) => (
    <>
      <div className="grid gap-2 md:hidden">
        {logs.map((log) => (
          <div key={log.id} className="rounded-lg border p-3 cursor-pointer hover:bg-muted/40" onClick={() => setSelectedLog(log)}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium break-words">{log.employeeName || "Unknown employee"}</p>
                <p className="text-xs text-muted-foreground break-all">{log.employeeId}{log.employeePhoneNumber ? ` · ${log.employeePhoneNumber}` : ""}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge variant={log.status === "In" ? "default" : "secondary"}>{log.status}</Badge>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Reported at</p>
                <p>{getReportedAt(log) ? format(getReportedAt(log)!, "dd MMM yyyy, hh:mm a") : "Pending"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Distance</p>
                <p className={log.distanceMeters != null ? (log.distanceMeters > (log.geofenceRadiusAtTime ?? 200) ? "text-red-600 font-medium" : "text-green-600") : ""}>
                  {log.distanceMeters != null
                    ? (log.distanceMeters < 1000 ? `${Math.round(log.distanceMeters)} m` : `${(log.distanceMeters / 1000).toFixed(1)} km`)
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Site</p>
                <p className="flex items-center gap-1">
                  {log.siteName || "Unknown site"}
                  {log.sourceCollection === "clientLocations" && (
                    <span className="text-[10px] bg-muted rounded px-1 py-0.5 font-medium">Office</span>
                  )}
                </p>
                {log.dutyPointName && (
                  <p className="text-xs text-muted-foreground">{log.dutyPointName}</p>
                )}
                <p className="text-xs text-muted-foreground">{log.clientName || "Unknown client"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">District / Shift</p>
                <p>{log.district || "N/A"}</p>
                {(log.shiftLabel || log.shiftCode) && <p className="text-xs text-muted-foreground">{log.shiftLabel || log.shiftCode}</p>}
              </div>
              {log.photoCompliance && (
                <div className="col-span-2">
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
              <TableHead>Site / District</TableHead>
              <TableHead className="hidden xl:table-cell">Shift</TableHead>
              <TableHead className="hidden lg:table-cell">Distance</TableHead>
              <TableHead>Compliance</TableHead>
              <TableHead className="w-8"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((log) => (
              <TableRow
                key={log.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => setSelectedLog(log)}
              >
                <TableCell>
                  <div className="font-medium">{log.employeeName || "Unknown employee"}</div>
                  <div className="text-xs text-muted-foreground">{log.employeeId}</div>
                  {log.employeePhoneNumber && (
                    <div className="text-xs text-muted-foreground">{log.employeePhoneNumber}</div>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {getReportedAt(log) ? format(getReportedAt(log)!, "dd MMM yyyy") : "—"}
                  <div className="text-xs text-muted-foreground">
                    {getReportedAt(log) ? format(getReportedAt(log)!, "hh:mm a") : "Pending"}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={log.status === "In" ? "default" : "secondary"}>{log.status}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1 text-sm">
                    {log.siteName || "Unknown site"}
                    {log.sourceCollection === "clientLocations" && (
                      <span className="text-[10px] bg-muted rounded px-1 py-0.5 font-medium">Office</span>
                    )}
                  </div>
                  {log.dutyPointName && (
                    <div className="text-xs text-muted-foreground">{log.dutyPointName}</div>
                  )}
                  <div className="text-xs text-muted-foreground">{log.clientName || "Unknown client"}</div>
                  <div className="text-xs text-muted-foreground">{log.district || ""}</div>
                </TableCell>
                <TableCell className="hidden xl:table-cell text-sm">
                  {log.shiftLabel || log.shiftCode ? (
                    <div>
                      <div>{log.shiftLabel || log.shiftCode}</div>
                      {log.shiftStartTime && log.shiftEndTime && (
                        <div className="text-xs text-muted-foreground">{log.shiftStartTime} – {log.shiftEndTime}</div>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-sm">
                  {log.distanceMeters != null ? (
                    <div>
                      <span className={log.distanceMeters > (log.geofenceRadiusAtTime ?? 200) ? "text-red-600 font-medium" : "text-green-600"}>
                        {log.distanceMeters < 1000
                          ? `${Math.round(log.distanceMeters)} m`
                          : `${(log.distanceMeters / 1000).toFixed(1)} km`}
                      </span>
                      {log.geofenceRadiusAtTime && (
                        <div className="text-xs text-muted-foreground">fence: {log.geofenceRadiusAtTime} m</div>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {log.photoCompliance ? (
                      <Badge
                        variant={log.photoCompliance.overallStatus === "clear" ? "outline" : "destructive"}
                        className="text-[10px]"
                      >
                        {log.photoCompliance.overallStatus === "clear" ? "Clear" : log.photoCompliance.overallStatus === "warning" ? "Review" : "N/A"}
                      </Badge>
                    ) : null}
                    {log.isMockLocationSuspected && <Badge variant="destructive" className="text-[10px]">Mock GPS</Badge>}
                    {log.requiresLocationReview && <Badge variant="secondary" className="text-[10px]">Location</Badge>}
                    {log.photoCompliance?.adminFlag && <Badge variant="secondary" className="text-[10px]">Flagged</Badge>}
                    {!log.photoCompliance && !log.isMockLocationSuspected && (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );

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
              {districtOptions.map((district) => (
                <SelectItem key={district} value={district}>
                  {district}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={isClientView ? (clientInfo?.clientName || clientFilter) : clientFilter}
            onValueChange={setClientFilter}
            disabled={isClientView}
          >
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
          {isClientView && (
            <p className="text-xs text-muted-foreground sm:col-span-2 xl:col-span-4">
              Client filter is locked to your account scope.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>The list updates automatically as new attendance records arrive.</CardDescription>
          </div>
          {groupedLogs.length > 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={allExpanded ? handleCollapseAll : handleExpandAll}
            >
              {allExpanded ? (
                <>
                  <ChevronUp className="mr-1 h-4 w-4" />
                  Collapse all
                </>
              ) : (
                <>
                  <ChevronDown className="mr-1 h-4 w-4" />
                  Expand all
                </>
              )}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
              No attendance records match the current filters.
            </div>
          ) : (
            <Accordion
              type="multiple"
              value={expandedValues}
              onValueChange={setExpandedValues}
            >
              {groupedLogs.map(([date, clients]) => {
                const dateLogs = clients.flatMap(([, logs]) => logs);
                const inCount = dateLogs.filter((l) => l.status === "In").length;
                const outCount = dateLogs.filter((l) => l.status === "Out").length;
                const employeeCount = new Set(dateLogs.map((l) => l.employeeId)).size;
                const formattedDate = date !== "Unknown"
                  ? (() => {
                      const [y, m, d] = date.split("-").map(Number);
                      return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      });
                    })()
                  : "Unknown date";

                return (
                  <AccordionItem key={date} value={date} className="border rounded-lg mb-3 overflow-hidden">
                    <AccordionTrigger className="px-4 py-3 hover:no-underline">
                      <div className="flex flex-1 items-center gap-3 text-left">
                        <span className="text-sm font-semibold whitespace-nowrap">{formattedDate}</span>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="bg-muted px-1.5 py-0.5 rounded font-medium tabular-nums">{dateLogs.length}</span>
                          <span className="text-green-600 font-medium tabular-nums">{inCount} IN</span>
                          <span className="text-orange-600 font-medium tabular-nums">{outCount} OUT</span>
                          <span className="text-muted-foreground/60">{employeeCount} guard{employeeCount !== 1 ? "s" : ""}</span>
                          {!isClientView && <span className="text-muted-foreground/60">{clients.length} client{clients.length !== 1 ? "s" : ""}</span>}
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-2 pb-2">
                      {isClientView ? (
                        renderLogList(dateLogs)
                      ) : clients.length === 1 ? (
                        renderLogList(clients[0][1])
                      ) : (
                        <Accordion type="multiple" className="space-y-1">
                          {clients.map(([client, clientLogs]) => {
                            const cIn = clientLogs.filter((l) => l.status === "In").length;
                            const cOut = clientLogs.filter((l) => l.status === "Out").length;
                            const cEmp = new Set(clientLogs.map((l) => l.employeeId)).size;
                            const clientKey = `${date}||${client}`;
                            return (
                              <AccordionItem key={clientKey} value={clientKey} className="border rounded-md overflow-hidden">
                                <AccordionTrigger className="px-3 py-2 hover:no-underline text-sm">
                                  <span className="font-medium">{client}</span>
                                  <span className="ml-auto mr-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <span className="bg-muted px-1.5 py-0.5 rounded tabular-nums">{clientLogs.length}</span>
                                    <span className="text-green-600 tabular-nums">{cIn} IN</span>
                                    <span className="text-orange-600 tabular-nums">{cOut} OUT</span>
                                    <span className="text-muted-foreground/60">{cEmp}</span>
                                  </span>
                                </AccordionTrigger>
                                <AccordionContent className="px-2 pb-2">
                                  {renderLogList(clientLogs)}
                                </AccordionContent>
                              </AccordionItem>
                            );
                          })}
                        </Accordion>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </CardContent>
      </Card>

      {/* Detail sheet */}
      <Sheet open={!!selectedLog} onOpenChange={(open) => { if (!open) setSelectedLog(null); }}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {selectedLog && (
            <>
              <SheetHeader className="mb-3">
                <SheetTitle className="flex items-center gap-2">
                  <Badge variant={selectedLog.status === "In" ? "default" : "secondary"} className="text-sm px-2">{selectedLog.status}</Badge>
                  {selectedLog.employeeName || "Unknown employee"}
                </SheetTitle>
                <p className="text-sm text-muted-foreground">{selectedLog.employeeId}{selectedLog.employeePhoneNumber ? ` · ${selectedLog.employeePhoneNumber}` : ""}</p>
              </SheetHeader>

              {/* Photo */}
              {selectedLog.photoUrl && (
                <div className="mb-4 overflow-hidden rounded-xl border bg-muted/30">
                  <div className="relative aspect-[4/3] w-full bg-background">
                    <Image
                      src={selectedLog.photoUrl}
                      alt="Attendance photo"
                      fill
                      sizes="(max-width: 640px) 100vw, 48rem"
                      className="object-contain"
                    />
                  </div>
                  {selectedLog.photoCapturedAt && (
                    <p className="border-t bg-background px-3 py-2 text-xs text-muted-foreground">
                      Photo taken: {format(new Date(selectedLog.photoCapturedAt), "dd MMM yyyy, hh:mm:ss a")}
                    </p>
                  )}
                </div>
              )}

              {/* Essentials */}
              <div className="space-y-4 text-sm">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Reported at</p>
                    <p className="mt-1 font-medium">
                      {getReportedAt(selectedLog) ? format(getReportedAt(selectedLog)!, "dd MMM yyyy, hh:mm a") : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Server recorded</p>
                    <p className="mt-1 font-medium">
                      {selectedLog.createdAt?.toDate ? format(selectedLog.createdAt.toDate(), "dd MMM yyyy, hh:mm a") : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Attendance date</p>
                    <p className="mt-1 font-medium">{selectedLog.attendanceDate || "—"}</p>
                  </div>
                </div>

                {selectedLog.clockDriftWarning && (
                  <Alert variant="destructive" className="mt-3">
                    <ShieldAlert className="h-4 w-4" />
                    <AlertTitle>Clock drift detected</AlertTitle>
                    <AlertDescription>{selectedLog.clockDriftWarning}</AlertDescription>
                  </Alert>
                )}

                <Separator />

                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> Site</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Site</p>
                    <p className="font-medium">
                      {selectedLog.siteName || "—"} {selectedLog.sourceCollection === "clientLocations" && <span className="ml-1 rounded bg-muted px-1 text-[10px]">Office</span>}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Client</p>
                    <p className="font-medium">{selectedLog.clientName || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">District</p>
                    <p className="font-medium">{selectedLog.district || "—"}</p>
                  </div>
                  {selectedLog.dutyPointName && (
                    <div>
                      <p className="text-xs text-muted-foreground">Duty point</p>
                      <p className="font-medium">{selectedLog.dutyPointName}</p>
                    </div>
                  )}
                  {(selectedLog.shiftLabel || selectedLog.shiftCode) && (
                    <div className="sm:col-span-2">
                      <p className="text-xs text-muted-foreground">Shift</p>
                      <p className="font-medium">{selectedLog.shiftLabel || selectedLog.shiftCode}</p>
                      {selectedLog.shiftStartTime && selectedLog.shiftEndTime && (
                        <p className="text-xs text-muted-foreground">{selectedLog.shiftStartTime} – {selectedLog.shiftEndTime}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
