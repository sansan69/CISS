"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAppAuth } from "@/context/auth-context";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import { Download, CheckCircle2, Pencil, Users, IndianRupee, Banknote, ShieldCheck, Eye } from "lucide-react";
import type { PayrollCycle, PayrollEntry, PayrollCycleStatus } from "@/types/payroll";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<PayrollCycleStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-gray-100 text-gray-700" },
  processing: { label: "Processing", className: "bg-blue-100 text-blue-700" },
  review: { label: "In Review", className: "bg-amber-100 text-amber-700" },
  finalized: { label: "Finalized", className: "bg-green-100 text-green-700" },
  paid: { label: "Paid", className: "bg-emerald-100 text-emerald-700" },
};

export default function PayrollCyclePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { userRole } = useAppAuth();
  const { toast } = useToast();
  const [cycleId, setCycleId] = useState<string | null>(null);
  const [cycle, setCycle] = useState<PayrollCycle | null>(null);
  const [entries, setEntries] = useState<PayrollEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showFinalizeDialog, setShowFinalizeDialog] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isGeneratingPayslips, setIsGeneratingPayslips] = useState(false);
  const [editEntry, setEditEntry] = useState<PayrollEntry | null>(null);
  const [editNetPay, setEditNetPay] = useState<string>("");
  const [editNotes, setEditNotes] = useState<string>("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  useEffect(() => {
    if (userRole !== null && userRole !== "admin" && userRole !== "superAdmin") {
      router.replace("/dashboard");
    }
  }, [userRole, router]);

  useEffect(() => {
    params.then(({ id }) => setCycleId(id));
  }, [params]);

  const loadData = useCallback(async (id: string) => {
    try {
      const res = await authorizedFetch(`/api/admin/payroll/cycles/${id}`);
      const data = await res.json();
      setCycle(data.cycle);
      setEntries(data.entries ?? []);
    } catch {
      toast({ title: "Error", description: "Failed to load cycle", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (cycleId) loadData(cycleId);
  }, [cycleId, loadData]);

  const handleFinalize = async () => {
    if (!cycleId) return;
    setIsFinalizing(true);
    try {
      const res = await authorizedFetch(`/api/admin/payroll/cycles/${cycleId}/finalize`, { method: "POST" });
      if (!res.ok) throw new Error("Finalize failed");
      toast({ title: "Finalized", description: "Payroll cycle has been finalized." });
      loadData(cycleId);
    } catch {
      toast({ title: "Error", description: "Failed to finalize", variant: "destructive" });
    } finally {
      setIsFinalizing(false);
      setShowFinalizeDialog(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editEntry) return;
    setIsSavingEdit(true);
    try {
      const res = await authorizedFetch(`/api/admin/payroll/entries/${editEntry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          netPay: parseFloat(editNetPay),
          adminNotes: editNotes,
        }),
      });
      if (!res.ok) throw new Error("Update failed");
      toast({ title: "Updated", description: "Entry updated successfully." });
      setEditEntry(null);
      if (cycleId) loadData(cycleId);
    } catch {
      toast({ title: "Error", description: "Failed to update entry", variant: "destructive" });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleGeneratePayslips = async () => {
    if (!cycleId) return;
    setIsGeneratingPayslips(true);
    try {
      const res = await authorizedFetch(`/api/admin/payroll/cycles/${cycleId}/payslips`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not prepare payslips.");
      toast({ title: "Payslips ready", description: `${data.generatedCount} payslip links prepared.` });
      loadData(cycleId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Could not prepare payslips.";
      toast({ title: "Error", description: message, variant: "destructive" });
    } finally {
      setIsGeneratingPayslips(false);
    }
  };

  const downloadWorksheet = async () => {
    if (!cycleId) return;
    try {
      const res = await authorizedFetch(`/api/admin/payroll/cycles/${cycleId}/worksheet`);
      if (!res.ok) throw new Error("Could not export payroll worksheet.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `CISS_Payroll_${cycle?.period ?? "worksheet"}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Could not export payroll worksheet.";
      toast({ title: "Error", description: message, variant: "destructive" });
    }
  };

  const downloadCSV = () => {
    if (!entries.length) return;
    const headers = ["Employee", "Code", "Client", "District", "Present Days", "Working Days", "LOP", "Gross", "EPF", "ESIC", "PT", "TDS", "LOP Deduction", "Net Pay", "Status"];
    const rows = entries.map((e) => [
      e.employeeName,
      e.employeeCode,
      e.clientName,
      e.district,
      e.presentDays,
      e.workingDays,
      e.lopDays,
      e.earnings.grossEarnings,
      e.deductions.epfEmployee,
      e.deductions.esicEmployee,
      e.deductions.professionalTax,
      e.deductions.tds,
      e.deductions.lopDeduction,
      e.netPay,
      e.status,
    ]);

    const csvContent = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-${cycle?.period ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const status = cycle ? STATUS_CONFIG[cycle.status] : null;

  const kpis = cycle ? [
    { label: "Employees", value: cycle.totalEmployees.toString(), icon: Users },
    { label: "Gross Pay", value: `₹${cycle.totalGross.toLocaleString()}`, icon: IndianRupee },
    { label: "Net Pay", value: `₹${cycle.totalNetPay.toLocaleString()}`, icon: Banknote },
    { label: "EPF + ESIC", value: `₹${(cycle.totalEPF + cycle.totalESIC).toLocaleString()}`, icon: ShieldCheck },
  ] : [];

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-14 w-full" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Payroll — ${cycle?.period ?? "..."}`}
        backHref="/payroll"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={downloadWorksheet}>
              <Download className="h-4 w-4 mr-1.5" /> Payroll Sheet
            </Button>
            <Button variant="outline" size="sm" onClick={downloadCSV}>
              <Download className="h-4 w-4 mr-1.5" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handleGeneratePayslips} disabled={isGeneratingPayslips || entries.length === 0}>
              <Download className="h-4 w-4 mr-1.5" /> {isGeneratingPayslips ? "Preparing..." : "Payslips"}
            </Button>
            {cycle && cycle.status !== "finalized" && cycle.status !== "paid" && (
              <Button size="sm" onClick={() => setShowFinalizeDialog(true)}>
                <CheckCircle2 className="h-4 w-4 mr-1.5" /> Finalize
              </Button>
            )}
          </div>
        }
      />

      {/* Status Badge */}
      {cycle && status && (
        <div className="flex items-center gap-3">
          <span className={cn("inline-flex items-center px-3 py-1 rounded-full text-sm font-medium", status.className)}>
            {status.label}
          </span>
          <span className="text-sm text-muted-foreground">{entries.length} entries</span>
        </div>
      )}

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
                <span className="text-xl font-bold">{value}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Entries Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payroll Entries</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-muted-foreground">No entries found in this cycle.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Employee</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Client</th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Present/Working</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">LOP</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Gross</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Deductions</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Net Pay</th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium truncate max-w-[160px]">{entry.employeeName}</p>
                        <p className="text-xs text-muted-foreground">{entry.employeeCode}</p>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <p className="truncate max-w-[120px] text-muted-foreground text-xs">{entry.clientName}</p>
                      </td>
                      <td className="px-4 py-3 text-center hidden sm:table-cell">
                        {entry.presentDays}/{entry.workingDays}
                      </td>
                      <td className="px-4 py-3 text-right hidden sm:table-cell text-red-600">
                        {entry.lopDays > 0 ? entry.lopDays : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">₹{entry.earnings.grossEarnings.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right hidden lg:table-cell text-red-600">
                        ₹{entry.deductions.totalDeductions.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">₹{entry.netPay.toLocaleString()}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                          entry.status === "finalized" ? "bg-green-100 text-green-700" :
                          entry.status === "adjusted" ? "bg-blue-100 text-blue-700" :
                          "bg-gray-100 text-gray-600"
                        )}>
                          {entry.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2"
                            onClick={() => router.push(`/payroll/cycles/${cycleId}/entries/${entry.id}`)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2"
                            onClick={() => window.open(entry.payslipUrl || `/api/admin/payroll/entries/${entry.id}/payslip`, "_blank")}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          {cycle?.status !== "finalized" && cycle?.status !== "paid" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => {
                                setEditEntry(entry);
                                setEditNetPay(String(entry.netPay));
                                setEditNotes(entry.adminNotes ?? "");
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Entry Sheet */}
      <Sheet open={!!editEntry} onOpenChange={(open) => { if (!open) setEditEntry(null); }}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit Payroll Entry</SheetTitle>
            <SheetDescription>{editEntry?.employeeName} — {cycle?.period}</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div className="space-y-1.5">
              <Label>Net Pay Override ₹</Label>
              <Input
                type="number"
                value={editNetPay}
                onChange={(e) => setEditNetPay(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Admin Notes</Label>
              <Input
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Reason for adjustment..."
              />
            </div>
            <Button onClick={handleSaveEdit} disabled={isSavingEdit} className="w-full">
              {isSavingEdit ? "Saving..." : "Save Override"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Finalize Dialog */}
      <AlertDialog open={showFinalizeDialog} onOpenChange={setShowFinalizeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finalize Payroll?</AlertDialogTitle>
            <AlertDialogDescription>
              Once finalized, entries cannot be changed. This will lock all {entries.length} entries.
              Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleFinalize} disabled={isFinalizing}>
              {isFinalizing ? "Finalizing..." : "Finalize"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
