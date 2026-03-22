"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAppAuth } from "@/context/auth-context";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import { Plus, Pencil, Trash2 } from "lucide-react";
import type { SalaryStructure, WageComponent } from "@/types/payroll";
import { applyWageComponents } from "@/lib/payroll/calculate";

interface Client { id: string; name: string; }

export default function SalaryGradesPage() {
  const router = useRouter();
  const { userRole } = useAppAuth();
  const { toast } = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [structures, setStructures] = useState<SalaryStructure[]>([]);
  const [wageComponents, setWageComponents] = useState<WageComponent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingStructure, setEditingStructure] = useState<SalaryStructure | null>(null);
  const [newGradeName, setNewGradeName] = useState("");
  const [newGrossMonthly, setNewGrossMonthly] = useState<number>(15000);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (userRole !== null && userRole !== "admin" && userRole !== "superAdmin") {
      router.replace("/dashboard");
    }
  }, [userRole, router]);

  useEffect(() => {
    authorizedFetch("/api/admin/clients")
      .then((res) => res.json())
      .then((data) => setClients(data.clients ?? []))
      .catch(() => {});
  }, []);

  const loadData = useCallback(async (clientId: string) => {
    setIsLoading(true);
    try {
      const [structData, configData] = await Promise.allSettled([
        authorizedFetch(`/api/admin/salary-structures?clientId=${clientId}`).then((r) => r.json()),
        authorizedFetch(`/api/admin/clients/${clientId}/wage-config`).then((r) => r.json()),
      ]);
      if (structData.status === "fulfilled") setStructures(structData.value.structures ?? []);
      if (configData.status === "fulfilled") setWageComponents(configData.value.components ?? []);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedClientId) loadData(selectedClientId);
  }, [selectedClientId, loadData]);

  const computedBreakdown = wageComponents.length > 0
    ? applyWageComponents(newGrossMonthly, wageComponents)
    : null;

  const handleCreate = async () => {
    if (!selectedClientId || !newGradeName || !newGrossMonthly) return;
    setIsSaving(true);
    const selectedClient = clients.find((c) => c.id === selectedClientId);
    try {
      const res = await authorizedFetch("/api/admin/salary-structures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedClientId,
          clientName: selectedClient?.name ?? "",
          name: newGradeName,
          grossMonthly: newGrossMonthly,
          componentAmounts: computedBreakdown ?? {},
        }),
      });
      if (!res.ok) throw new Error("Create failed");
      toast({ title: "Created", description: `Grade "${newGradeName}" saved.` });
      setSheetOpen(false);
      setNewGradeName("");
      setNewGrossMonthly(15000);
      loadData(selectedClientId);
    } catch {
      toast({ title: "Error", description: "Failed to create grade", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingStructure) return;
    setIsSaving(true);
    try {
      const res = await authorizedFetch(`/api/admin/salary-structures/${editingStructure.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newGradeName,
          grossMonthly: newGrossMonthly,
          componentAmounts: computedBreakdown ?? {},
        }),
      });
      if (!res.ok) throw new Error("Update failed");
      toast({ title: "Updated", description: `Grade "${newGradeName}" saved.` });
      setSheetOpen(false);
      setEditingStructure(null);
      setNewGradeName("");
      setNewGrossMonthly(15000);
      loadData(selectedClientId);
    } catch {
      toast({ title: "Error", description: "Failed to update grade", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (structure: SalaryStructure) => {
    try {
      const res = await authorizedFetch(`/api/admin/salary-structures/${structure.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      toast({ title: "Deleted", description: `Removed ${structure.name}.` });
      loadData(selectedClientId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to delete grade";
      toast({ title: "Error", description: message, variant: "destructive" });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Salary Grade Templates"
        description="Define reusable salary grades per client"
        backHref="/settings"
        actions={
          selectedClientId ? (
            <Button onClick={() => {
              setEditingStructure(null);
              setNewGradeName("");
              setNewGrossMonthly(15000);
              setSheetOpen(true);
            }}>
              <Plus className="h-4 w-4 mr-1.5" /> New Grade
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader><CardTitle className="text-base">Select Client</CardTitle></CardHeader>
        <CardContent>
          <Select value={selectedClientId} onValueChange={setSelectedClientId}>
            <SelectTrigger className="max-w-sm"><SelectValue placeholder="Choose a client..." /></SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedClientId && (
        isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}
          </div>
        ) : structures.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground text-sm">No salary grades yet. Click &quot;New Grade&quot; to create one.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {structures.map((s) => (
              <Card key={s.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">{s.name}</CardTitle>
                      <CardDescription>₹{s.grossMonthly.toLocaleString()} / month</CardDescription>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => {
                        setEditingStructure(s);
                        setNewGradeName(s.name);
                        setNewGrossMonthly(s.grossMonthly);
                        setSheetOpen(true);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    {Object.entries(s.componentAmounts).slice(0, 4).map(([id, amount]) => {
                      const comp = wageComponents.find((c) => c.id === id);
                      return (
                        <div key={id} className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{comp?.name ?? id}</span>
                          <span>₹{(amount as number).toFixed(0)}</span>
                        </div>
                      );
                    })}
                    {Object.keys(s.componentAmounts).length > 4 && (
                      <p className="text-xs text-muted-foreground">+{Object.keys(s.componentAmounts).length - 4} more</p>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-3 px-0 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(s)}
                    >
                      <Trash2 className="mr-1.5 h-4 w-4" />
                      Delete grade
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      )}

      {/* New Grade Sheet */}
      <Sheet open={sheetOpen} onOpenChange={(open) => {
        setSheetOpen(open);
        if (!open) {
          setEditingStructure(null);
        }
      }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>New Salary Grade</SheetTitle>
            <SheetDescription>{editingStructure ? "Edit reusable salary template" : "Create a new reusable salary template"}</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div className="space-y-1.5">
              <Label>Grade Name</Label>
              <Input
                value={newGradeName}
                onChange={(e) => setNewGradeName(e.target.value)}
                placeholder="e.g. Guard Grade A"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Gross Monthly ₹</Label>
              <Input
                type="number"
                value={newGrossMonthly}
                onChange={(e) => setNewGrossMonthly(parseFloat(e.target.value) || 0)}
              />
            </div>

            {computedBreakdown && (
              <div className="p-4 bg-muted/50 rounded-xl space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Component Breakdown</p>
                {Object.entries(computedBreakdown).map(([id, amount]) => {
                  const comp = wageComponents.find((c) => c.id === id);
                  return (
                    <div key={id} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{comp?.name ?? id}</span>
                      <span className="font-medium">₹{amount.toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {wageComponents.length === 0 && (
              <p className="text-xs text-amber-600 bg-amber-50 p-3 rounded-lg">
                No wage components configured for this client. Set up wage config first.
              </p>
            )}

            <Button onClick={editingStructure ? handleSaveEdit : handleCreate} disabled={isSaving || !newGradeName} className="w-full">
              {isSaving ? "Saving..." : editingStructure ? "Save Grade" : "Create Grade"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
