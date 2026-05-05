"use client";

import React, { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import type { PayrollCycle, PayrollEntry } from "@/types/payroll";
import { Download } from "lucide-react";

export default function PayrollEntryDetailPage({
  params,
}: {
  params: Promise<{ id: string; entryId: string }>;
}) {
  const { toast } = useToast();
  const [cycleId, setCycleId] = useState<string | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [cycle, setCycle] = useState<PayrollCycle | null>(null);
  const [entry, setEntry] = useState<PayrollEntry | null>(null);
  const [netPay, setNetPay] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    params.then(({ id, entryId }) => {
      setCycleId(id);
      setEntryId(entryId);
    });
  }, [params]);

  const loadEntry = useCallback(async (id: string, targetEntryId: string) => {
    setLoading(true);
    try {
      const res = await authorizedFetch(`/api/admin/payroll/cycles/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load payroll entry.");
      const matched = (data.entries ?? []).find((item: PayrollEntry) => item.id === targetEntryId) ?? null;
      setCycle(data.cycle ?? null);
      setEntry(matched);
      setNetPay(matched ? String(matched.netPay) : "");
      setAdminNotes(matched?.adminNotes || "");
    } catch (error: any) {
      toast({
        title: "Could not load payroll entry",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (cycleId && entryId) {
      void loadEntry(cycleId, entryId);
    }
  }, [cycleId, entryId, loadEntry]);

  const handleSave = async () => {
    if (!entry) return;
    setSaving(true);
    try {
      const res = await authorizedFetch(`/api/admin/payroll/entries/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          netPay: Number(netPay),
          adminNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update payroll entry.");
      toast({ title: "Payroll entry updated" });
      if (cycleId && entryId) {
        await loadEntry(cycleId, entryId);
      }
    } catch (error: any) {
      toast({
        title: "Update failed",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (!entry) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Payroll Entry" backHref={cycleId ? `/payroll/cycles/${cycleId}` : "/payroll"} />
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Payroll entry not found.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={entry.employeeName}
        backHref={cycleId ? `/payroll/cycles/${cycleId}` : "/payroll"}
        description={`${cycle?.period || entry.period} · ${entry.clientName || "No client"}`}
        actions={
          <Button variant="outline" onClick={() => window.open(entry.payslipUrl || `/api/admin/payroll/entries/${entry.id}/payslip`, "_blank")}>
            <Download className="mr-1.5 h-4 w-4" />
            Payslip PDF
          </Button>
        }
      />

      <Card>
        <CardContent className="grid gap-4 p-6 md:grid-cols-2">
          <div><p className="text-sm text-muted-foreground">Employee Code</p><p className="text-base font-semibold">{entry.employeeCode}</p></div>
          <div><p className="text-sm text-muted-foreground">District</p><p className="text-base font-semibold">{entry.district || "—"}</p></div>
          <div><p className="text-sm text-muted-foreground">Gross Earnings</p><p className="text-base font-semibold">₹{entry.earnings.grossEarnings.toLocaleString("en-IN")}</p></div>
          <div><p className="text-sm text-muted-foreground">Total Deductions</p><p className="text-base font-semibold">₹{entry.deductions.totalDeductions.toLocaleString("en-IN")}</p></div>
          <div><p className="text-sm text-muted-foreground">Present / Working Days</p><p className="text-base font-semibold">{entry.presentDays}/{entry.workingDays}</p></div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-4 p-6 md:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-semibold">Earnings</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Basic</span><span>₹{entry.earnings.basic.toLocaleString("en-IN")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">HRA</span><span>₹{entry.earnings.hra.toLocaleString("en-IN")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">DA</span><span>₹{entry.earnings.da.toLocaleString("en-IN")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Conveyance</span><span>₹{entry.earnings.conveyance.toLocaleString("en-IN")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Special Allowance</span><span>₹{entry.earnings.specialAllowance.toLocaleString("en-IN")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Other Allowances</span><span>₹{entry.earnings.otherAllowances.toLocaleString("en-IN")}</span></div>
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold">Deductions</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">EPF</span><span>₹{entry.deductions.epfEmployee.toLocaleString("en-IN")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">ESIC</span><span>₹{entry.deductions.esicEmployee.toLocaleString("en-IN")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Professional Tax</span><span>₹{entry.deductions.professionalTax.toLocaleString("en-IN")}</span></div>
               <div className="flex justify-between"><span className="text-muted-foreground">TDS</span><span>₹{entry.deductions.tds.toLocaleString("en-IN")}</span></div>
               <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span>₹{entry.deductions.totalDeductions.toLocaleString("en-IN")}</span></div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="space-y-1.5">
            <Label>Net Pay</Label>
            <Input type="number" value={netPay} onChange={(e) => setNetPay(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Admin Notes</Label>
            <Textarea rows={4} value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} />
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
