"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAppAuth } from "@/context/auth-context";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import { Play, Eye, Users, IndianRupee, Banknote, ShieldCheck } from "lucide-react";
import type { PayrollCycle, PayrollCycleStatus } from "@/types/payroll";

const STATUS_CONFIG: Record<PayrollCycleStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-gray-100 text-gray-700" },
  processing: { label: "Processing", className: "bg-blue-100 text-blue-700" },
  review: { label: "Review", className: "bg-amber-100 text-amber-700" },
  finalized: { label: "Finalized", className: "bg-green-100 text-green-700" },
  paid: { label: "Paid", className: "bg-emerald-100 text-emerald-700" },
};

export default function PayrollPage() {
  const router = useRouter();
  const { userRole } = useAppAuth();
  const { toast } = useToast();
  const [cycles, setCycles] = useState<PayrollCycle[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (userRole !== null && userRole !== "admin" && userRole !== "superAdmin") {
      router.replace("/dashboard");
    }
  }, [userRole, router]);

  const loadCycles = useCallback(async () => {
    try {
      const res = await authorizedFetch("/api/admin/payroll/cycles");
      const data = await res.json();
      setCycles(data.cycles ?? []);
    } catch {
      toast({ title: "Error", description: "Failed to load payroll cycles", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadCycles(); }, [loadCycles]);

  const latest = cycles[0];

  const kpis = [
    { label: "Total Gross", value: latest ? `₹${latest.totalGross.toLocaleString()}` : "—", icon: IndianRupee },
    { label: "Net Pay", value: latest ? `₹${latest.totalNetPay.toLocaleString()}` : "—", icon: Banknote },
    { label: "EPF + ESIC", value: latest ? `₹${(latest.totalEPF + latest.totalESIC).toLocaleString()}` : "—", icon: ShieldCheck },
    { label: "Employees", value: latest ? latest.totalEmployees.toString() : "—", icon: Users },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payroll"
        description="Manage monthly payroll cycles"
        actions={
          <Button onClick={() => router.push("/payroll/run")}>
            <Play className="h-4 w-4 mr-1.5" /> Run Payroll
          </Button>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-xl font-bold">{isLoading ? <Skeleton className="h-6 w-16 inline-block" /> : value}</span>
              </div>
              {latest && <p className="text-xs text-muted-foreground mt-1">{latest.period}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Cycles Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payroll Cycles</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : cycles.length === 0 ? (
            <div className="py-16 text-center">
              <Banknote className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No payroll runs yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Click Run Payroll to start your first payroll cycle.</p>
              <Button className="mt-4" onClick={() => router.push("/payroll/run")}>
                <Play className="h-4 w-4 mr-1.5" /> Run Payroll
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Period</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Employees</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Gross</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Net Pay</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">EPF</th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {cycles.map((cycle) => {
                    const status = STATUS_CONFIG[cycle.status];
                    return (
                      <tr key={cycle.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 font-medium">{cycle.period}</td>
                        <td className="px-4 py-3 text-right">{cycle.totalEmployees}</td>
                        <td className="px-4 py-3 text-right hidden sm:table-cell">₹{cycle.totalGross.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right hidden md:table-cell">₹{cycle.totalNetPay.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right hidden lg:table-cell">₹{cycle.totalEPF.toLocaleString()}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${status.className}`}>
                            {status.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => router.push(`/payroll/cycles/${cycle.id}`)}
                          >
                            <Eye className="h-4 w-4 mr-1" /> View
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
