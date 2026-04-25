"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onSnapshot, collection, query } from "firebase/firestore";
import { CalendarRange, ClipboardList, FileClock, FileText, Loader2, Rows3, SquareStack, MapPin } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppAuth } from "@/context/auth-context";
import { isWorkOrderAdminRole } from "@/lib/work-orders";
import { db } from "@/lib/firebase";

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

function ImportCard({ record }: { record: GroupedImport }) {
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
          <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-200 capitalize">
            {record.rowCount} work orders
          </Badge>
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
          return {
            sourceFileName: typeof d.sourceFileName === "string" ? d.sourceFileName : "",
            examName: typeof d.examName === "string" ? d.examName : "",
            examCode: typeof d.examCode === "string" ? d.examCode : "",
            siteId: typeof d.siteId === "string" ? d.siteId : "",
            siteName: typeof d.siteName === "string" ? d.siteName : "",
            district: typeof d.district === "string" ? d.district : "",
            date: toDate(d.date),
            maleGuardsRequired: Number(d.maleGuardsRequired ?? 0),
            femaleGuardsRequired: Number(d.femaleGuardsRequired ?? 0),
            totalManpower: Number(d.totalManpower ?? 0),
          };
        });

        // Group by sourceFileName + examName
        const groups = new Map<string, {
          examName: string;
          fileName: string;
          sites: Set<string>;
          dates: Date[];
          rowCount: number;
          totalGuards: number;
        }>();

        for (const order of orders) {
          const key = order.sourceFileName || order.examName || order.examCode || "Legacy";
          const existing = groups.get(key);
          if (existing) {
            existing.sites.add(order.siteId);
            if (order.date) existing.dates.push(order.date);
            existing.rowCount += 1;
            existing.totalGuards += order.totalManpower || order.maleGuardsRequired + order.femaleGuardsRequired;
          } else {
            const sites = new Set<string>();
            if (order.siteId) sites.add(order.siteId);
            groups.set(key, {
              examName: order.examName || order.examCode || "Untitled",
              fileName: order.sourceFileName || "",
              sites,
              dates: order.date ? [order.date] : [],
              rowCount: 1,
              totalGuards: order.totalManpower || order.maleGuardsRequired + order.femaleGuardsRequired,
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
            };
          })
          .sort((a, b) => {
            // Sort by earliest date descending (newest first)
            if (a.earliestDate && b.earliestDate) {
              return b.earliestDate.getTime() - a.earliestDate.getTime();
            }
            return b.rowCount - a.rowCount;
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

  const latestImport = imports[0];

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
        description="All uploaded exam workbooks grouped by source file."
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
        <StatCard label="Imports" value={String(imports.length)} icon={FileClock} />
        <StatCard label="Work Orders" value={String(totals.rows)} icon={Rows3} />
        <StatCard label="Sites" value={String(totals.sites)} icon={MapPin} />
        <StatCard label="Total Guards" value={String(totals.guards)} icon={SquareStack} />
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
      ) : imports.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
              <FileText className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-semibold">No import history yet</p>
              <p className="text-sm text-muted-foreground">
                Imported exam workbooks will appear here once they are committed.
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
            {imports.map((record) => (
              <ImportCard key={record.key} record={record} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
