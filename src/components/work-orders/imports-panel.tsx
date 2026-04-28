"use client";

import React, { useEffect, useMemo, useState } from "react";
import { onSnapshot, collection, query } from "firebase/firestore";
import { ChevronDown, ChevronUp, FileClock, Loader2, MapPin, Rows3, SquareStack } from "lucide-react";

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
import { db } from "@/lib/firebase";
import { isOperationalWorkOrderClientName } from "@/lib/work-orders";

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
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base font-semibold truncate">
              {record.examName || "Untitled"}
            </CardTitle>
            <CardDescription className="truncate">
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Date Range</p>
            <p className="font-semibold">{record.dateFrom || "—"} to {record.dateTo || "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Sites</p>
            <p className="font-semibold">{record.siteCount}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Total Guards</p>
            <p className="font-semibold">{record.totalGuards}</p>
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
      {[0, 1, 2].map((index) => (
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

export function WorkOrderImportsPanel() {
  const [imports, setImports] = useState<GroupedImport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<string>("date-desc");

  const SORT_OPTIONS = [
    { value: "date-desc", label: "Latest first" },
    { value: "date-asc", label: "Earliest first" },
    { value: "exam-asc", label: "Exam A → Z" },
    { value: "exam-desc", label: "Exam Z → A" },
  ];

  useEffect(() => {
    // Fetch all work orders without date filter for now
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

        const groups = new Map<string, {
          examName: string;
          fileName: string;
          sites: Set<string>;
          dates: Date[];
          rowCount: number;
          totalGuards: number;
          workOrders: WorkOrderRow[];
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
  }, []);

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
        default:
          return (b.earliestDate?.getTime() ?? 0) - (a.earliestDate?.getTime() ?? 0);
      }
    });
  }, [imports, sort]);

  const latestImport = sortedImports[0];

  if (isLoading) {
    return <LoadingState />;
  }

  if (queryError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
          <p className="text-destructive">{queryError}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Imports</CardTitle>
            <FileClock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sortedImports.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Work Orders</CardTitle>
            <Rows3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.rows}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sites</CardTitle>
            <MapPin className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.sites}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Guards</CardTitle>
            <SquareStack className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.guards}</div>
          </CardContent>
        </Card>
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

      {sortedImports.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <p className="text-muted-foreground">No work orders found</p>
          </CardContent>
        </Card>
      ) : (
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
      )}
    </div>
  );
}
