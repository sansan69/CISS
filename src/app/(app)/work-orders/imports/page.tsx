"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { onSnapshot, collection, query } from "firebase/firestore";
import { CalendarRange, ChevronDown, ChevronUp, ClipboardList, FileClock, FileText, Loader2, Rows3, SquareStack, MapPin } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAppAuth } from "@/context/auth-context";
import { isOperationalWorkOrderClientName, isWorkOrderAdminRole } from "@/lib/work-orders";
import { db } from "@/lib/firebase";
import { OPERATIONAL_CLIENT_NAME } from "@/lib/constants";

interface WorkOrderRow {
  id: string;
  siteId: string;
  siteName: string;
  district: string;
  date: string;
  maleGuardsRequired: number;
  femaleGuardsRequired: number;
  totalManpower: number;
  recordStatus: string;
  assignedMale: number;
  assignedFemale: number;
  clientName: string;
}

interface GroupedImport {
  key: string;
  examName: string;
  fileName: string;
  dateFrom: string;
  dateTo: string;
  siteCount: number;
  rowCount: number;
  totalGuards: number;
  earliestDate: Date | null;
  workOrders: WorkOrderRow[];
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object" && "toDate" in value && typeof (value as any).toDate === "function") {
    return (value as any).toDate();
  }
  if (typeof value === "object" && "seconds" in value && typeof (value as any).seconds === "number") {
    return new Date((value as any).seconds * 1000);
  }
  return null;
}

function formatDate(value: Date | null): string {
  if (!value) return "—";
  return value.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateRange(from: Date | null, to: Date | null): string {
  if (!from && !to) return "—";
  if (from && to && from.getTime() !== to.getTime()) {
    return `${formatDate(from)} to ${formatDate(to)}`;
  }
  return formatDate(from) || formatDate(to) || "—";
}

function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon: React.ElementType }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="truncate text-lg font-semibold leading-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function getStatusBadge(status: string) {
  const s = status.trim().toLowerCase();
  if (s === "active") return <Badge className="bg-green-100 text-green-700 border-green-200 capitalize">Active</Badge>;
  if (s === "cancelled") return <Badge variant="destructive" className="capitalize">Cancelled</Badge>;
  return <Badge variant="outline" className="capitalize">{s || "Active"}</Badge>;
}

function ImportCard({ record, isExpanded, onToggle }: { record: GroupedImport; isExpanded: boolean; onToggle: () => void }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle className="truncate text-base sm:text-lg">
              {record.examName || "Untitled import"}
            </CardTitle>
            <CardDescription className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 shrink-0" />
              <span className="truncate">{record.fileName || "Unknown file"}</span>
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-200 capitalize">
              {record.rowCount} work orders
            </Badge>
            <Button variant="ghost" size="sm" onClick={onToggle} className="gap-1.5 px-2">
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              <span className="text-xs">{isExpanded ? "Hide" : "Details"}</span>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border bg-muted/30 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Date range</p>
            <p className="mt-1 text-sm font-semibold">{formatDateRange(record.earliestDate ? new Date(record.dateFrom) : null, record.earliestDate ? new Date(record.dateTo) : null)}</p>
          </div>
          <div className="rounded-xl border bg-muted/30 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Sites</p>
            <p className="mt-1 text-sm font-semibold">{record.siteCount}</p>
          </div>
          <div className="rounded-xl border bg-muted/30 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Work Orders</p>
            <p className="mt-1 text-sm font-semibold">{record.rowCount}</p>
          </div>
          <div className="rounded-xl border bg-muted/30 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Total Guards</p>
            <p className="mt-1 text-sm font-semibold">{record.totalGuards}</p>
          </div>
        </div>

        {isExpanded && record.workOrders.length > 0 && (
          <div className="rounded-xl border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Site</TableHead>
                  <TableHead className="text-xs">District</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs text-center">Male</TableHead>
                  <TableHead className="text-xs text-center">Female</TableHead>
                  <TableHead className="text-xs text-center">Assigned</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {record.workOrders.map((wo) => {
                  const required = wo.totalManpower || (wo.maleGuardsRequired || 0) + (wo.femaleGuardsRequired || 0);
                  const assigned = (wo.assignedMale || 0) + (wo.assignedFemale || 0);
                  return (
                    <TableRow key={wo.id} className={wo.recordStatus?.trim().toLowerCase() === "cancelled" ? "opacity-50" : ""}>
                      <TableCell className="text-xs">{wo.date || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[160px] truncate">{wo.siteName || "—"}</TableCell>
                      <TableCell className="text-xs capitalize">{wo.district || "—"}</TableCell>
                      <TableCell className="text-xs">{getStatusBadge(wo.recordStatus || "active")}</TableCell>
                      <TableCell className="text-xs text-center font-medium">{wo.maleGuardsRequired ?? 0}</TableCell>
                      <TableCell className="text-xs text-center font-medium">{wo.femaleGuardsRequired ?? 0}</TableCell>
                      <TableCell className="text-xs text-center">
                        <span className={assigned >= required ? "text-green-600" : assigned > 0 ? "text-amber-600" : "text-muted-foreground"}>
                          {assigned}/{required}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-20 rounded-xl" />
          ))}
        </CardContent>
      </Card>
      {Array.from({ length: 3 }).map((_, index) => (
        <Card key={index}>
          <CardHeader>
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function WorkOrderImportsPage() {
  const router = useRouter();
  const { userRole } = useAppAuth();
  const [imports, setImports] = useState<GroupedImport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const searchParams = useSearchParams();
  const [sort, setSort] = useState<string>(searchParams.get("sort") || "date-desc");

  const SORT_OPTIONS = [
    { value: "date-desc", label: "Latest first" },
    { value: "date-asc", label: "Earliest first" },
    { value: "exam-asc", label: "Exam A → Z" },
    { value: "exam-desc", label: "Exam Z → A" },
  ];

  useEffect(() => {
    if (userRole !== null && !isWorkOrderAdminRole(userRole)) {
      router.replace("/dashboard");
    }
  }, [router, userRole]);

  useEffect(() => {
    if (!isWorkOrderAdminRole(userRole)) {
      return;
    }

    const workOrdersQuery = query(collection(db, "workOrders"));

    const unsubscribe = onSnapshot(
      workOrdersQuery,
      (snapshot) => {
        const orders = snapshot.docs.map((doc) => {
          const d = doc.data();
          const assignedGuards: string[] = Array.isArray(d.assignedGuards) ? d.assignedGuards : [];
          return {
            id: doc.id,
            sourceFileName: typeof d.sourceFileName === "string" ? d.sourceFileName : "",
            examName: typeof d.examName === "string" ? d.examName : "",
            examCode: typeof d.examCode === "string" ? d.examCode : "",
            siteId: typeof d.siteId === "string" ? d.siteId : "",
            siteName: typeof d.siteName === "string" ? d.siteName : "",
            district: typeof d.district === "string" ? d.district : "",
            date: d.date
              ? new Date(typeof d.date === "string" ? d.date : (d.date.seconds ? d.date.seconds * 1000 : d.date))
                  .toISOString()
                  .split("T")[0]
              : "",
            maleGuardsRequired: Number(d.maleGuardsRequired ?? 0),
            femaleGuardsRequired: Number(d.femaleGuardsRequired ?? 0),
            totalManpower: Number(d.totalManpower ?? 0),
            recordStatus: typeof d.recordStatus === "string" ? d.recordStatus : "active",
            clientName: typeof d.clientName === "string" ? d.clientName : "",
            assignedMale: assignedGuards.filter((g: string) => {
              const parts = g.split(":");
              return parts.length >= 3 && parts[2]?.toLowerCase() === "male";
            }).length,
            assignedFemale: assignedGuards.filter((g: string) => {
              const parts = g.split(":");
              return parts.length >= 3 && parts[2]?.toLowerCase() === "female";
            }).length,
          };
        }).filter((order) => isOperationalWorkOrderClientName(order.clientName));

        // Group by sourceFileName + examName
        const groups = new Map<string, {
          examName: string;
          fileName: string;
          sites: Set<string>;
          dates: Date[];
          rowCount: number;
          totalGuards: number;
          workOrders: {
            id: string;
            sourceFileName: string;
            examName: string;
            examCode: string;
            siteId: string;
            siteName: string;
            district: string;
            date: string;
            maleGuardsRequired: number;
            femaleGuardsRequired: number;
            totalManpower: number;
            recordStatus: string;
            clientName: string;
            assignedMale: number;
            assignedFemale: number;
          }[];
        }>();

        for (const order of orders) {
          const key = order.sourceFileName || order.examName || order.examCode || "Legacy";
          const existing = groups.get(key);
          if (existing) {
            existing.sites.add(order.siteId);
            if (order.date) existing.dates.push(new Date(order.date));
            existing.rowCount += 1;
            existing.totalGuards += order.totalManpower || order.maleGuardsRequired + order.femaleGuardsRequired;
            existing.workOrders.push(order);
          } else {
            const sites = new Set<string>();
            if (order.siteId) sites.add(order.siteId);
            groups.set(key, {
              examName: order.examName || order.examCode || "Untitled",
              fileName: order.sourceFileName || "",
              sites,
              dates: order.date ? [new Date(order.date)] : [],
              rowCount: 1,
              totalGuards: order.totalManpower || order.maleGuardsRequired + order.femaleGuardsRequired,
              workOrders: [order],
            });
          }
        }

        const records: GroupedImport[] = Array.from(groups.entries())
          .map(([key, group]) => {
            const sortedDates = [...group.dates].sort((a, b) => a.getTime() - b.getTime());
            const dateFrom = sortedDates[0] ? sortedDates[0].toISOString().split("T")[0] : "";
            const dateTo = sortedDates[sortedDates.length - 1] ? sortedDates[sortedDates.length - 1].toISOString().split("T")[0] : "";
            return {
              key,
              examName: group.examName,
              fileName: group.fileName || group.examName,
              dateFrom,
              dateTo,
              siteCount: group.sites.size,
              rowCount: group.rowCount,
              totalGuards: group.totalGuards,
              earliestDate: sortedDates[0] || null,
              workOrders: group.workOrders,
            };
          });

        setImports(records);
        setQueryError(null);
        setIsLoading(false);
      },
      (error) => {
        console.error("Failed to load work orders:", error);
        setQueryError("Could not load import history. Please try again later.");
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [userRole]);

  const totals = useMemo(() => {
    return imports.reduce(
      (acc, record) => {
        acc.rows += record.rowCount;
        acc.sites += record.siteCount;
        acc.guards += record.totalGuards;
        return acc;
      },
      { rows: 0, sites: 0, guards: 0 },
    );
  }, [imports]);

  const sortedImports = useMemo(() => {
    return [...imports].sort((a, b) => {
      switch (sort) {
        case "date-asc":
          return (a.earliestDate?.getTime() ?? 0) - (b.earliestDate?.getTime() ?? 0);
        case "exam-asc":
          return (a.examName || "").localeCompare(b.examName || "");
        case "exam-desc":
          return (b.examName || "").localeCompare(a.examName || "");
        default: // date-desc
          return (b.earliestDate?.getTime() ?? 0) - (a.earliestDate?.getTime() ?? 0);
      }
    });
  }, [imports, sort]);

  const latestImport = sortedImports[0];

  if (userRole !== null && !isWorkOrderAdminRole(userRole)) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Redirecting to the dashboard...
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <PageHeader
        eyebrow="Work Orders"
        title="Import History"
        description={`All uploaded ${OPERATIONAL_CLIENT_NAME} exam workbooks grouped by source file.`}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Work Orders", href: "/work-orders" },
          { label: "Import History" },
        ]}
        actions={
          <Button variant="outline" size="sm" asChild className="w-full sm:w-auto">
            <Link href="/work-orders">
              <ClipboardList className="mr-2 h-4 w-4" />
              <span>Back to Work Orders</span>
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Imports" value={String(sortedImports.length)} icon={FileClock} />
        <StatCard label="Work Orders" value={String(totals.rows)} icon={Rows3} />
        <StatCard label="Sites" value={String(totals.sites)} icon={MapPin} />
        <StatCard label="Total Guards" value={String(totals.guards)} icon={SquareStack} />
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {sortedImports.length} import{sortedImports.length !== 1 ? "s" : ""}
        </p>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : queryError ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
              <FileText className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-semibold">Import history unavailable</p>
              <p className="text-sm text-muted-foreground">{queryError}</p>
            </div>
          </CardContent>
        </Card>
      ) : sortedImports.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
              <FileText className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-semibold">No import history yet</p>
              <p className="text-sm text-muted-foreground">
                Imported {OPERATIONAL_CLIENT_NAME} exam workbooks will appear here once they are committed.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {latestImport && (
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Latest import
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-sm">
                  <span className="font-medium text-foreground">{latestImport.examName || "Untitled import"}</span>
                  <span className="text-muted-foreground"> from </span>
                  <span className="text-muted-foreground">{latestImport.fileName || "Unknown file"}</span>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="space-y-4">
            {sortedImports.map((record) => (
              <ImportCard
                key={record.key}
                record={record}
                isExpanded={expandedKeys.has(record.key)}
                onToggle={() => setExpandedKeys(prev => {
                  const next = new Set(prev);
                  if (next.has(record.key)) next.delete(record.key);
                  else next.add(record.key);
                  return next;
                })}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
