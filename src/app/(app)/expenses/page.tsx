"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAppAuth } from "@/context/auth-context";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import { Receipt, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Branch, ExpenseSheetStatus } from "@/types/branch";
import Link from "next/link";

const STATUS_CONFIG: Record<ExpenseSheetStatus, { label: string; className: string }> = {
  draft:     { label: "Draft",     className: "bg-gray-100 text-gray-600" },
  submitted: { label: "Submitted", className: "bg-amber-100 text-amber-700" },
  approved:  { label: "Approved",  className: "bg-green-100 text-green-700" },
};

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

interface ExpenseSummary {
  branchId: string;
  branchName: string;
  totalAmount: number;
  status: ExpenseSheetStatus;
}

export default function ExpensesPage() {
  const { userRole } = useAppAuth();
  const { toast } = useToast();
  const isAdmin = userRole === "admin" || userRole === "superAdmin";

  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonth());
  const [branches, setBranches] = useState<Branch[]>([]);
  const [summaries, setSummaries] = useState<ExpenseSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async (month: string) => {
    setIsLoading(true);
    try {
      const res = await authorizedFetch("/api/admin/branches");
      const data = await res.json();
      const branchesList: Branch[] = data.branches ?? [];
      setBranches(branchesList);

      // Fetch expense summary for each branch
      const expenseFetches = branchesList.map(async (b) => {
        try {
          const eRes = await authorizedFetch(`/api/admin/expenses/${b.id}/${month}`);
          const eData = await eRes.json();
          return {
            branchId: b.id,
            branchName: b.name,
            totalAmount: eData.expense?.totalAmount ?? 0,
            status: (eData.expense?.status ?? "draft") as ExpenseSheetStatus,
          };
        } catch {
          return { branchId: b.id, branchName: b.name, totalAmount: 0, status: "draft" as ExpenseSheetStatus };
        }
      });

      const results = await Promise.all(expenseFetches);
      setSummaries(results);
    } catch {
      toast({ title: "Error", description: "Failed to load expense data", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!isAdmin) return;
    loadData(selectedMonth);
  }, [isAdmin, selectedMonth, loadData]);

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Branch Expenses" />
        <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">Admin access required.</CardContent></Card>
      </div>
    );
  }

  const totalAcrossAll = summaries.reduce((sum, s) => sum + s.totalAmount, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Branch Expenses"
        description="View and manage expense sheets by branch and month"
      />

      {/* Month Selector */}
      <div className="flex items-end gap-3">
        <div className="w-48 space-y-1.5">
          <Label>Select Month</Label>
          <Input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          />
        </div>
        <div className="text-sm text-muted-foreground pb-1.5">
          Total across all branches:{" "}
          <strong className="text-foreground">₹{totalAcrossAll.toLocaleString("en-IN")}</strong>
        </div>
      </div>

      {/* Branch List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : branches.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Receipt className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">No branches found. Add branches in Branch Ops.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {summaries.map((summary) => {
            const sc = STATUS_CONFIG[summary.status];
            return (
              <Card key={summary.branchId} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{summary.branchName}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        ₹{summary.totalAmount.toLocaleString("en-IN")} · {selectedMonth}
                      </p>
                    </div>
                    <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium", sc.className)}>
                      {sc.label}
                    </span>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/expenses/${summary.branchId}/${selectedMonth}`}>
                        View / Edit
                        <ChevronRight className="h-3.5 w-3.5 ml-1" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
