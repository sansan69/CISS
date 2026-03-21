"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAppAuth } from "@/context/auth-context";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import { Plus, Building2, FileText, GraduationCap, Clock, IndianRupee } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Branch } from "@/types/branch";
import Link from "next/link";

interface Stats {
  totalBranches: number;
  visitReportsThisMonth: number;
  trainingSessions: number;
  pendingReviews: number;
  expenseTotalThisMonth: number;
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function BranchOpsPage() {
  const { userRole } = useAppAuth();
  const { toast } = useToast();
  const isAdmin = userRole === "admin" || userRole === "superAdmin";

  const [branches, setBranches] = useState<Branch[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState({ name: "", district: "", stateCode: "KL" });

  const currentMonth = getCurrentMonth();

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [branchRes, visitRes, trainingRes] = await Promise.all([
        authorizedFetch("/api/admin/branches"),
        authorizedFetch("/api/admin/visit-reports"),
        authorizedFetch("/api/admin/training-reports"),
      ]);

      const [branchData, visitData, trainingData] = await Promise.all([
        branchRes.json(),
        visitRes.json(),
        trainingRes.json(),
      ]);

      const branchesList: Branch[] = branchData.branches ?? [];
      setBranches(branchesList);

      const allVisits = visitData.reports ?? [];
      const allTrainings = trainingData.reports ?? [];

      // Filter this month
      const monthStart = new Date(`${currentMonth}-01`).getTime() / 1000;
      const visitsThisMonth = allVisits.filter((r: { createdAt?: { seconds: number } }) => {
        const sec = r.createdAt?.seconds ?? 0;
        return sec >= monthStart;
      });
      const trainingsThisMonth = allTrainings.filter((r: { createdAt?: { seconds: number } }) => {
        const sec = r.createdAt?.seconds ?? 0;
        return sec >= monthStart;
      });
      const pendingReviews = allVisits.filter((r: { status: string }) => r.status === "submitted").length;

      setStats({
        totalBranches: branchesList.length,
        visitReportsThisMonth: visitsThisMonth.length,
        trainingSessions: trainingsThisMonth.length,
        pendingReviews,
        expenseTotalThisMonth: 0,
      });
    } catch {
      toast({ title: "Error", description: "Failed to load branch data", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast, currentMonth]);

  useEffect(() => {
    if (!isAdmin) return;
    loadData();
  }, [isAdmin, loadData]);

  const handleCreate = async () => {
    if (!form.name || !form.district) {
      toast({ title: "Missing fields", description: "Branch name and district are required.", variant: "destructive" });
      return;
    }
    setIsCreating(true);
    try {
      const res = await authorizedFetch("/api/admin/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Create failed");
      toast({ title: "Branch created", description: `${form.name} has been added.` });
      setDialogOpen(false);
      setForm({ name: "", district: "", stateCode: "KL" });
      loadData();
    } catch {
      toast({ title: "Error", description: "Failed to create branch", variant: "destructive" });
    } finally {
      setIsCreating(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Branch Operations" />
        <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">Admin access required.</CardContent></Card>
      </div>
    );
  }

  const KPI_CARDS = [
    { label: "Total Branches", value: stats?.totalBranches ?? 0, icon: Building2, color: "text-brand-blue" },
    { label: "Visits This Month", value: stats?.visitReportsThisMonth ?? 0, icon: FileText, color: "text-amber-600" },
    { label: "Training Sessions", value: stats?.trainingSessions ?? 0, icon: GraduationCap, color: "text-purple-600" },
    { label: "Pending Reviews", value: stats?.pendingReviews ?? 0, icon: Clock, color: "text-red-500" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Branch Operations"
        description="Manage field branches, visits, and trainings"
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> New Branch
          </Button>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {KPI_CARDS.map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-4">
              {isLoading ? (
                <Skeleton className="h-12 w-full" />
              ) : (
                <div className="flex items-center gap-3">
                  <kpi.icon className={cn("h-8 w-8 shrink-0", kpi.color)} />
                  <div>
                    <p className="text-2xl font-bold leading-tight">{kpi.value}</p>
                    <p className="text-xs text-muted-foreground">{kpi.label}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Expense Summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <IndianRupee className="h-4 w-4 text-brand-gold" />
            Expense Summary — {currentMonth}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            View detailed expense sheets in{" "}
            <Link href="/expenses" className="text-brand-blue underline underline-offset-2">Branch Expenses</Link>.
          </p>
        </CardContent>
      </Card>

      {/* Branch List */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Branches</h3>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : branches.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Building2 className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No branches yet. Create one to get started.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {branches.map((branch) => (
              <Card key={branch.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{branch.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {branch.district} · {branch.stateCode}
                        {branch.fieldOfficerIds?.length
                          ? ` · ${branch.fieldOfficerIds.length} FO${branch.fieldOfficerIds.length !== 1 ? "s" : ""}`
                          : ""}
                      </p>
                    </div>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/expenses?branch=${branch.id}`}>Expenses</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* New Branch Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Branch</DialogTitle>
            <DialogDescription>Add a new field branch to the system</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Branch Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Kerala - Ernakulam Branch"
              />
            </div>
            <div className="space-y-1.5">
              <Label>District *</Label>
              <Input
                value={form.district}
                onChange={(e) => setForm((f) => ({ ...f, district: e.target.value }))}
                placeholder="e.g. Ernakulam"
              />
            </div>
            <div className="space-y-1.5">
              <Label>State Code</Label>
              <Input
                value={form.stateCode}
                onChange={(e) => setForm((f) => ({ ...f, stateCode: e.target.value.toUpperCase() }))}
                maxLength={2}
                placeholder="KL"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={isCreating}>
                {isCreating ? "Creating..." : "Create Branch"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
