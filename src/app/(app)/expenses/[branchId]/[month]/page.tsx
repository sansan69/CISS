"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useAppAuth } from "@/context/auth-context";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import { Plus, Trash2, Download, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BranchExpense, ExpenseEntry, ExpenseCategory, ExpenseSheetStatus } from "@/types/branch";

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "Travel", "Fuel", "Stationery", "Communication",
  "Equipment", "Maintenance", "Utilities", "Miscellaneous",
];

const STATUS_CONFIG: Record<ExpenseSheetStatus, { label: string; className: string }> = {
  draft:     { label: "Draft",     className: "bg-gray-100 text-gray-600" },
  submitted: { label: "Submitted", className: "bg-amber-100 text-amber-700" },
  approved:  { label: "Approved",  className: "bg-green-100 text-green-700" },
};

function nanoid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export default function ExpenseDetailPage() {
  const params = useParams() as { branchId: string; month: string };
  const { branchId, month } = params;
  const { userRole } = useAppAuth();
  const { toast } = useToast();
  const isAdmin = userRole === "admin";

  const [expense, setExpense] = useState<BranchExpense | null>(null);
  const [branchName, setBranchName] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isApproving, setIsApproving] = useState(false);

  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [entryForm, setEntryForm] = useState<{
    date: string; category: ExpenseCategory; description: string;
    amount: string; vendor: string;
  }>({
    date: new Date().toISOString().slice(0, 10),
    category: "Travel",
    description: "",
    amount: "",
    vendor: "",
  });

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [expRes, branchRes] = await Promise.all([
        authorizedFetch(`/api/admin/expenses/${branchId}/${month}`),
        authorizedFetch(`/api/admin/branches`),
      ]);
      const [expData, branchData] = await Promise.all([expRes.json(), branchRes.json()]);
      setExpense(expData.expense ?? null);

      const branch = (branchData.branches ?? []).find((b: { id: string; name: string }) => b.id === branchId);
      setBranchName(branch?.name ?? branchId);
    } catch {
      toast({ title: "Error", description: "Failed to load expense sheet", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [branchId, month, toast]);

  useEffect(() => {
    if (!isAdmin) return;
    loadData();
  }, [isAdmin, loadData]);

  const saveExpense = async (updatedEntries: ExpenseEntry[], status?: ExpenseSheetStatus) => {
    setIsSaving(true);
    try {
      const currentStatus = status ?? expense?.status ?? "draft";
      const res = await authorizedFetch(`/api/admin/expenses/${branchId}/${month}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: updatedEntries, status: currentStatus }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast({ title: "Saved", description: "Expense sheet updated." });
      loadData();
    } catch {
      toast({ title: "Error", description: "Failed to save", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddEntry = async () => {
    if (!entryForm.description || !entryForm.amount) {
      toast({ title: "Missing fields", description: "Description and amount are required.", variant: "destructive" });
      return;
    }
    const newEntry: ExpenseEntry = {
      id: nanoid(),
      date: entryForm.date,
      category: entryForm.category,
      description: entryForm.description,
      amount: parseFloat(entryForm.amount) || 0,
      vendor: entryForm.vendor,
    };
    const currentEntries = expense?.entries ?? [];
    await saveExpense([...currentEntries, newEntry]);
    setAddSheetOpen(false);
    setEntryForm({ date: new Date().toISOString().slice(0, 10), category: "Travel", description: "", amount: "", vendor: "" });
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (!expense) return;
    const updated = expense.entries.filter((e) => e.id !== entryId);
    await saveExpense(updated);
  };

  const handleSubmitForApproval = async () => {
    if (!expense) return;
    await saveExpense(expense.entries, "submitted");
  };

  const handleApprove = async () => {
    setIsApproving(true);
    try {
      const res = await authorizedFetch(`/api/admin/expenses/${branchId}/${month}/approve`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Approve failed");
      toast({ title: "Approved", description: "Expense sheet approved." });
      loadData();
    } catch {
      toast({ title: "Error", description: "Failed to approve", variant: "destructive" });
    } finally {
      setIsApproving(false);
    }
  };

  const handleDownloadCSV = () => {
    if (!expense?.entries?.length) return;
    const headers = ["Date", "Category", "Description", "Vendor", "Amount"];
    const rows = expense.entries.map((e) =>
      [e.date, e.category, e.description, e.vendor ?? "", e.amount.toString()].map((v) => `"${v}"`).join(",")
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses-${branchId}-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Branch Expenses" backHref="/expenses" />
        <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">Admin access required.</CardContent></Card>
      </div>
    );
  }

  const isLocked = expense?.status === "approved";
  const statusConf = expense?.status ? STATUS_CONFIG[expense.status] : STATUS_CONFIG.draft;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Expenses — ${branchName} · ${month}`}
        backHref="/expenses"
        actions={
          <div className="flex items-center gap-2">
            <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium", statusConf.className)}>
              {statusConf.label}
            </span>
            {expense?.status === "submitted" && isAdmin && (
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700"
                onClick={handleApprove}
                disabled={isApproving}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                {isApproving ? "Approving..." : "Approve"}
              </Button>
            )}
            {(expense?.entries?.length ?? 0) > 0 && (
              <Button variant="outline" size="sm" onClick={handleDownloadCSV}>
                <Download className="h-3.5 w-3.5 mr-1" />
                CSV
              </Button>
            )}
          </div>
        }
      />

      {/* Expense Table */}
      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between">
          <CardTitle className="text-base">Expense Entries</CardTitle>
          {!isLocked && (
            <Button size="sm" onClick={() => setAddSheetOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Add Expense
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !expense?.entries?.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No expenses recorded for this period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 pr-3 text-xs font-medium text-muted-foreground">Date</th>
                    <th className="pb-2 pr-3 text-xs font-medium text-muted-foreground">Category</th>
                    <th className="pb-2 pr-3 text-xs font-medium text-muted-foreground">Description</th>
                    <th className="pb-2 pr-3 text-xs font-medium text-muted-foreground">Vendor</th>
                    <th className="pb-2 pr-3 text-xs font-medium text-muted-foreground text-right">Amount</th>
                    {!isLocked && <th className="pb-2 text-xs font-medium text-muted-foreground"></th>}
                  </tr>
                </thead>
                <tbody>
                  {expense.entries.map((entry) => (
                    <tr key={entry.id} className="border-b last:border-0">
                      <td className="py-2.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">{entry.date}</td>
                      <td className="py-2.5 pr-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-muted text-xs font-medium">
                          {entry.category}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">{entry.description}</td>
                      <td className="py-2.5 pr-3 text-muted-foreground text-xs">{entry.vendor ?? "—"}</td>
                      <td className="py-2.5 pr-3 text-right font-medium whitespace-nowrap">
                        ₹{entry.amount.toLocaleString("en-IN")}
                      </td>
                      {!isLocked && (
                        <td className="py-2.5">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive hover:text-destructive/80 h-7 w-7"
                            onClick={() => handleDeleteEntry(entry.id)}
                            disabled={isSaving}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={isLocked ? 4 : 5} className="pt-3 text-xs font-semibold text-muted-foreground text-right pr-3">
                      Total
                    </td>
                    <td className="pt-3 text-right font-bold">
                      ₹{(expense.totalAmount ?? 0).toLocaleString("en-IN")}
                    </td>
                    {!isLocked && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status Actions */}
      {!isLocked && (
        <div className="flex justify-end gap-3">
          {expense?.status === "draft" && (
            <Button variant="outline" onClick={handleSubmitForApproval} disabled={isSaving}>
              Submit for Approval
            </Button>
          )}
        </div>
      )}

      {/* Add Expense Sheet */}
      <Sheet open={addSheetOpen} onOpenChange={setAddSheetOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Add Expense</SheetTitle>
            <SheetDescription>Add a new expense entry to this sheet</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input
                type="date"
                value={entryForm.date}
                onChange={(e) => setEntryForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select
                value={entryForm.category}
                onValueChange={(v) => setEntryForm((f) => ({ ...f, category: v as ExpenseCategory }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Description *</Label>
              <Input
                value={entryForm.description}
                onChange={(e) => setEntryForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What was this expense for?"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Vendor</Label>
              <Input
                value={entryForm.vendor}
                onChange={(e) => setEntryForm((f) => ({ ...f, vendor: e.target.value }))}
                placeholder="Vendor / supplier name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Amount (₹) *</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={entryForm.amount}
                onChange={(e) => setEntryForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0.00"
              />
            </div>
            <Button onClick={handleAddEntry} disabled={isSaving} className="w-full">
              {isSaving ? "Saving..." : "Add Entry"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
