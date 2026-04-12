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
import { Loader2, FileDown, Search, MapPin, Clock, Smartphone, ShieldAlert, Image as ImageIcon, ChevronRight } from "lucide-react";
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

type AttendanceLog = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeePhoneNumber?: string;
  status: "In" | "Out";
  district?: string;
  clientName?: string;
  siteName?: string;
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
  createdAt?: Timestamp;
  attendanceDate?: string;
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
  const { userRole, assignedDistricts, clientInfo, stateCode } = useAppAuth();
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [districtFilter, setDistrictFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AttendanceLog | null>(null);
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
              {districtOptions.map((district) => (
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
                        {filteredLogs.map((log) => (
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
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Detail sheet */}
      <Sheet open={!!selectedLog} onOpenChange={(open) => { if (!open) setSelectedLog(null); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selectedLog && (
            <>
              <SheetHeader className="mb-4">
                <SheetTitle className="flex items-center gap-2">
                  <Badge variant={selectedLog.status === "In" ? "default" : "secondary"} className="text-sm px-2">{selectedLog.status}</Badge>
                  {selectedLog.employeeName || "Unknown employee"}
                </SheetTitle>
                <p className="text-sm text-muted-foreground">{selectedLog.employeeId}{selectedLog.employeePhoneNumber ? ` · ${selectedLog.employeePhoneNumber}` : ""}</p>
              </SheetHeader>

              {/* Photo */}
              {selectedLog.photoUrl && (
                <div className="mb-4 rounded-lg overflow-hidden border">
                  <img src={selectedLog.photoUrl} alt="Attendance photo" className="w-full object-cover max-h-64" />
                  {selectedLog.photoCapturedAt && (
                    <p className="text-xs text-muted-foreground px-3 py-1.5 bg-muted">
                      Photo taken: {format(new Date(selectedLog.photoCapturedAt), "dd MMM yyyy, hh:mm:ss a")}
                    </p>
                  )}
                </div>
              )}

              {/* Timestamp */}
              <div className="space-y-3 text-sm">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Timestamp</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Reported at</p>
                    <p>{getReportedAt(selectedLog) ? format(getReportedAt(selectedLog)!, "dd MMM yyyy, hh:mm:ss a") : "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Server recorded</p>
                    <p>{selectedLog.createdAt?.toDate ? format(selectedLog.createdAt.toDate(), "dd MMM yyyy, hh:mm:ss a") : "—"}</p>
                  </div>
                  {selectedLog.attendanceDate && (
                    <div>
                      <p className="text-xs text-muted-foreground">Attendance date</p>
                      <p>{selectedLog.attendanceDate}</p>
                    </div>
                  )}
                </div>

                <Separator />

                {/* Site & Shift */}
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> Site & Shift</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Site</p>
                    <p>{selectedLog.siteName || "—"} {selectedLog.sourceCollection === "clientLocations" && <span className="text-[10px] bg-muted rounded px-1">Office</span>}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Client</p>
                    <p>{selectedLog.clientName || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">District</p>
                    <p>{selectedLog.district || "—"}</p>
                  </div>
                  {(selectedLog.shiftLabel || selectedLog.shiftCode) && (
                    <div>
                      <p className="text-xs text-muted-foreground">Shift</p>
                      <p>{selectedLog.shiftLabel || selectedLog.shiftCode}</p>
                      {selectedLog.shiftStartTime && selectedLog.shiftEndTime && (
                        <p className="text-xs text-muted-foreground">{selectedLog.shiftStartTime} – {selectedLog.shiftEndTime}</p>
                      )}
                    </div>
                  )}
                </div>

                <Separator />

                {/* GPS & Location */}
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> GPS & Location</h3>
                <div className="grid grid-cols-2 gap-3">
                  {selectedLog.locationText && (
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground">Location text</p>
                      <p>{selectedLog.locationText}</p>
                    </div>
                  )}
                  {selectedLog.locationCoords && (
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground">Coordinates</p>
                      <p className="font-mono text-xs">{selectedLog.locationCoords.lat.toFixed(6)}, {selectedLog.locationCoords.lon.toFixed(6)}</p>
                    </div>
                  )}
                  {selectedLog.distanceMeters != null && (
                    <div>
                      <p className="text-xs text-muted-foreground">Distance from site</p>
                      <p className={selectedLog.distanceMeters > (selectedLog.geofenceRadiusAtTime ?? 200) ? "text-red-600 font-medium" : "text-green-600"}>
                        {selectedLog.distanceMeters < 1000
                          ? `${Math.round(selectedLog.distanceMeters)} m`
                          : `${(selectedLog.distanceMeters / 1000).toFixed(2)} km`}
                      </p>
                    </div>
                  )}
                  {selectedLog.geofenceRadiusAtTime != null && (
                    <div>
                      <p className="text-xs text-muted-foreground">Geofence radius</p>
                      <p>{selectedLog.geofenceRadiusAtTime} m</p>
                    </div>
                  )}
                  {(selectedLog.gpsAccuracyMeters != null || selectedLog.locationAccuracyMeters != null) && (
                    <div>
                      <p className="text-xs text-muted-foreground">GPS accuracy</p>
                      <p>{selectedLog.gpsAccuracyMeters ?? selectedLog.locationAccuracyMeters} m</p>
                    </div>
                  )}
                </div>

                {(selectedLog.isMockLocationSuspected || selectedLog.requiresLocationReview) && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-1">
                    <p className="text-xs font-semibold text-red-700 flex items-center gap-1"><ShieldAlert className="h-3.5 w-3.5" /> Location Flags</p>
                    {selectedLog.isMockLocationSuspected && (
                      <p className="text-xs text-red-700">Mock location suspected{selectedLog.mockLocationReason ? `: ${selectedLog.mockLocationReason}` : ""}</p>
                    )}
                    {selectedLog.requiresLocationReview && (
                      <p className="text-xs text-red-700">Requires location review</p>
                    )}
                  </div>
                )}

                <Separator />

                {/* Photo Compliance */}
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><ImageIcon className="h-3.5 w-3.5" /> Uniform / Photo Compliance</h3>
                {selectedLog.photoCompliance ? (
                  <div className="space-y-2">
                    <Badge variant={selectedLog.photoCompliance.overallStatus === "clear" ? "outline" : "destructive"}>
                      {selectedLog.photoCompliance.overallStatus === "clear" ? "Clear" : selectedLog.photoCompliance.overallStatus === "warning" ? "Review required" : "AI check unavailable"}
                    </Badge>
                    {selectedLog.photoCompliance.summary && (
                      <p className="text-xs text-muted-foreground">{selectedLog.photoCompliance.summary}</p>
                    )}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {[
                        { label: "Uniform issue", val: selectedLog.photoCompliance.uniformIssue },
                        { label: "Missing ID card", val: selectedLog.photoCompliance.missingIdCard },
                        { label: "Missing shoes", val: selectedLog.photoCompliance.missingShoes },
                        { label: "Full body visible", val: !selectedLog.photoCompliance.fullBodyVisible },
                        { label: "One person visible", val: !selectedLog.photoCompliance.onePersonVisible },
                        { label: "Admin flagged", val: selectedLog.photoCompliance.adminFlag },
                      ].filter(f => f.val).map(f => (
                        <div key={f.label} className="flex items-center gap-1 text-amber-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                          {f.label}
                        </div>
                      ))}
                    </div>
                    {selectedLog.photoCompliance.warnings.length > 0 && (
                      <p className="text-xs text-muted-foreground">{selectedLog.photoCompliance.warnings.join(" · ")}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Not reviewed</p>
                )}

                {/* Device */}
                {selectedLog.deviceInfo?.userAgent && (
                  <>
                    <Separator />
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><Smartphone className="h-3.5 w-3.5" /> Device</h3>
                    <p className="text-xs text-muted-foreground break-all">{selectedLog.deviceInfo.userAgent}</p>
                  </>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
