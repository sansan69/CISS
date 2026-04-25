"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onSnapshot } from "firebase/firestore";
import { CalendarRange, ClipboardList, FileClock, FileText, Loader2, Rows3, SquareStack, AlertTriangle } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAppAuth } from "@/context/auth-context";
import { isWorkOrderAdminRole } from "@/lib/work-orders";
import { OPERATIONAL_CLIENT_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import {
  buildTcsWorkOrderImportsQuery,
  normalizeTcsWorkOrderImportRecords,
  type FirestoreTimestampLike,
  type WorkOrderImportRecord,
} from "./work-order-imports";

const STATUS_STYLES: Record<string, string> = {
  committed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  draft: "bg-amber-100 text-amber-700 border-amber-200",
  failed: "bg-red-100 text-red-700 border-red-200",
};

const MODE_STYLES: Record<string, string> = {
  new: "bg-blue-100 text-blue-700 border-blue-200",
  revision: "bg-violet-100 text-violet-700 border-violet-200",
};

function toDate(value: FirestoreTimestampLike): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate();
  }
  if (typeof value === "object" && "seconds" in value && typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }
  return null;
}

function formatDateTime(value: FirestoreTimestampLike): string {
  const date = toDate(value);
  return date ? date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

function formatDateRange(range?: WorkOrderImportRecord["dateRange"]): string {
  const from = range?.from?.trim();
  const to = range?.to?.trim();
  if (!from && !to) return "—";
  if (from && to && from !== to) return `${from} to ${to}`;
  return from || to || "—";
}

function labelForMode(mode?: string): string {
  if (!mode) return "—";
  return mode === "revision" ? "Revision" : mode === "new" ? "New import" : mode;
}

function labelForParserMode(parserMode?: string): string {
  if (!parserMode) return "—";
  return parserMode === "pivot-date-sheet" ? "Pivot date sheet" : parserMode === "legacy-sheet" ? "Legacy sheet" : parserMode;
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
}) {
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

function ImportCard({ record }: { record: WorkOrderImportRecord }) {
  const statusKey = (record.status ?? "").toLowerCase();
  const modeKey = (record.mode ?? "").toLowerCase();

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
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className={cn("capitalize", STATUS_STYLES[statusKey] ?? "bg-muted text-foreground")}>
              {record.status || "unknown"}
            </Badge>
            <Badge variant="outline" className={cn("capitalize", MODE_STYLES[modeKey] ?? "bg-muted text-foreground")}>
              {labelForMode(record.mode)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border bg-muted/30 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Date range</p>
            <p className="mt-1 text-sm font-semibold">{formatDateRange(record.dateRange)}</p>
          </div>
          <div className="rounded-xl border bg-muted/30 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Imported</p>
            <p className="mt-1 text-sm font-semibold">{formatDateTime(record.createdAt)}</p>
          </div>
          <div className="rounded-xl border bg-muted/30 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Parser</p>
            <p className="mt-1 text-sm font-semibold">{labelForParserMode(record.parserMode)}</p>
          </div>
          <div className="rounded-xl border bg-muted/30 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Client</p>
            <p className="mt-1 text-sm font-semibold">{record.clientName || OPERATIONAL_CLIENT_NAME}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Sites</p>
            <p className="mt-1 text-xl font-semibold">{record.siteCount ?? "—"}</p>
          </div>
          <div className="rounded-xl border p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Rows</p>
            <p className="mt-1 text-xl font-semibold">{record.rowCount ?? "—"}</p>
          </div>
          <div className="rounded-xl border p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Committed</p>
            <p className="mt-1 text-xl font-semibold">{record.committedRows ?? "—"}</p>
          </div>
          <div className="rounded-xl border p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Cancelled</p>
            <p className="mt-1 text-xl font-semibold">{record.cancelledRows ?? "—"}</p>
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
  const [imports, setImports] = useState<WorkOrderImportRecord[]>([]);
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

    const importsQuery = buildTcsWorkOrderImportsQuery();

    const unsubscribe = onSnapshot(
      importsQuery,
      (snapshot) => {
        const records = normalizeTcsWorkOrderImportRecords(snapshot);
        setImports(records);
        setQueryError(null);
        setIsLoading(false);
      },
      (error) => {
        console.error("Failed to load work order imports:", error);
        const message = error?.message || "";
        if (message.includes("index") || message.includes("requires an index")) {
          setQueryError(
            "Firestore index required. Run: firebase deploy --only firestore:indexes",
          );
        } else {
          setQueryError("Could not load import history. Please try again later.");
        }
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [userRole]);

  const totals = useMemo(() => {
    return imports.reduce(
      (acc, record) => {
        acc.rows += record.rowCount ?? 0;
        acc.committed += record.committedRows ?? 0;
        acc.cancelled += record.cancelledRows ?? 0;
        acc.sites += record.siteCount ?? 0;
        return acc;
      },
      { rows: 0, committed: 0, cancelled: 0, sites: 0 },
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
        description="Recent TCS workbook imports stored in workOrderImports."
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
        <StatCard label="Recent imports" value={String(imports.length)} icon={FileClock} />
        <StatCard label="Rows" value={String(totals.rows)} icon={Rows3} />
        <StatCard label="Committed" value={String(totals.committed)} icon={SquareStack} />
        <StatCard label="Cancelled" value={String(totals.cancelled)} icon={CalendarRange} />
      </div>

      {isLoading ? (
        <LoadingState />
      ) : queryError ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Import history unavailable</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{queryError}</p>
            {queryError.includes("index") && (
              <p className="text-xs">
                The Firestore composite index for <code>workOrderImports</code> (clientName ASC, createdAt DESC)
                must be deployed before import history can load.
              </p>
            )}
          </AlertDescription>
        </Alert>
      ) : imports.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
              <FileText className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-semibold">No import history yet</p>
              <p className="text-sm text-muted-foreground">
                Imported TCS workbooks will appear here once they are committed.
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
              <ImportCard key={record.id} record={record} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
