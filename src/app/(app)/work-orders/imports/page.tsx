"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarRange,
  ClipboardList,
  FileClock,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { authorizedFetch } from "@/lib/api-client";
import { useAppAuth } from "@/context/auth-context";
import { isWorkOrderAdminRole } from "@/lib/work-orders";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type ImportRecord = {
  id: string;
  packageId: string;
  examName: string;
  examCode: string;
  revisionNumber: number;
  supersedesImportId: string | null;
  mode: "new" | "revision";
  status: string;
  fileNames: string[];
  parserMode: string;
  dateRange: { from: string; to: string };
  siteCount: number;
  rowCount: number;
  totalMale: number;
  totalFemale: number;
  committedRows: number;
  cancelledRows: number;
  warnings: number;
  createdAt: string | null;
  createdByEmail: string;
};

function formatDateTime(value: string | null) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDutyRange(record: ImportRecord) {
  if (!record.dateRange.from && !record.dateRange.to) return "Duty dates unavailable";
  if (!record.dateRange.to || record.dateRange.from === record.dateRange.to) {
    return record.dateRange.from;
  }
  return `${record.dateRange.from} to ${record.dateRange.to}`;
}

export default function WorkOrderImportsPage() {
  const router = useRouter();
  const { userRole } = useAppAuth();
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (userRole !== null && !isWorkOrderAdminRole(userRole)) {
      router.replace("/dashboard");
    }
  }, [router, userRole]);

  const loadImports = useCallback(async () => {
    if (!isWorkOrderAdminRole(userRole)) return;
    setIsLoading(true);
    setError("");
    try {
      const response = await authorizedFetch("/api/admin/work-orders/imports");
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Could not load import history.");
      }
      setImports(Array.isArray(payload.imports) ? payload.imports : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load import history.");
    } finally {
      setIsLoading(false);
    }
  }, [userRole]);

  useEffect(() => {
    loadImports();
  }, [loadImports]);

  const totals = useMemo(
    () =>
      imports.reduce(
        (summary, record) => ({
          rows: summary.rows + record.rowCount,
          cancelled: summary.cancelled + record.cancelledRows,
          warnings: summary.warnings + record.warnings,
        }),
        { rows: 0, cancelled: 0, warnings: 0 },
      ),
    [imports],
  );

  if (userRole !== null && !isWorkOrderAdminRole(userRole)) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Redirecting…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Work orders"
        title="Revision history"
        description="Every committed exam-duty package, shown in revision order with its source files and operational impact."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Work orders", href: "/work-orders" },
          { label: "Revision history" },
        ]}
        actions={
          <div className="flex w-full gap-2 sm:w-auto">
            <Button variant="outline" size="sm" onClick={loadImports} disabled={isLoading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" asChild>
              <Link href="/work-orders">
                <ClipboardList className="mr-2 h-4 w-4" />
                Duty board
              </Link>
            </Button>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Import summary">
        {[
          { label: "Revisions", value: imports.length, icon: FileClock },
          { label: "Rows processed", value: totals.rows, icon: FileSpreadsheet },
          { label: "Centres cancelled", value: totals.cancelled, icon: CalendarRange },
          { label: "Warnings", value: totals.warnings, icon: TriangleAlert },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="flex items-center gap-3 py-4">
              <Icon className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xl font-semibold tabular-nums">{value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((item) => <Skeleton key={item} className="h-44 rounded-xl" />)}
        </div>
      ) : error ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">Revision history is unavailable</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={loadImports}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : imports.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <ShieldCheck className="mx-auto h-9 w-9 text-muted-foreground" />
            <p className="mt-3 font-medium">No committed work-order packages yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload the first exam-duty package from the duty board.
            </p>
          </CardContent>
        </Card>
      ) : (
        <section className="space-y-3" aria-label="Committed revisions">
          {imports.map((record) => (
            <Card key={record.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <CardTitle className="text-base">{record.examName}</CardTitle>
                    <CardDescription className="mt-1">
                      Uploaded {formatDateTime(record.createdAt)}
                      {record.createdByEmail ? ` by ${record.createdByEmail}` : ""}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={record.status === "committed" ? "default" : "secondary"}>
                      {record.status}
                    </Badge>
                    <Badge variant="outline">Revision {record.revisionNumber}</Badge>
                    <Badge variant="outline">{record.mode === "revision" ? "Revised package" : "New package"}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-5">
                  <div><p className="text-xs text-muted-foreground">Duty dates</p><p className="mt-1 font-medium">{formatDutyRange(record)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Centres</p><p className="mt-1 font-medium tabular-nums">{record.siteCount}</p></div>
                  <div><p className="text-xs text-muted-foreground">Committed rows</p><p className="mt-1 font-medium tabular-nums">{record.committedRows}</p></div>
                  <div><p className="text-xs text-muted-foreground">Cancelled rows</p><p className="mt-1 font-medium tabular-nums">{record.cancelledRows}</p></div>
                  <div><p className="text-xs text-muted-foreground">Guard requirement</p><p className="mt-1 font-medium tabular-nums">{record.totalMale} male · {record.totalFemale} female</p></div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Source files</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {record.fileNames.map((fileName) => (
                      <span key={fileName} className="rounded-md bg-muted px-2 py-1 text-xs">
                        {fileName}
                      </span>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
