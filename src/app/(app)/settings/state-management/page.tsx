"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAppAuth } from "@/context/auth-context";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import { Globe, Plus, ShieldCheck, AlertCircle } from "lucide-react";

interface StateEntry {
  id?: string;
  stateCode: string;
  stateName?: string;
  adminEmail?: string;
}

export default function StateManagementPage() {
  const { isSuperAdmin } = useAppAuth();
  const { toast } = useToast();

  const [states, setStates] = useState<StateEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState({ stateCode: "", stateName: "", adminEmail: "" });

  const loadStates = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await authorizedFetch("/api/admin/states");
      const data = await res.json();
      setStates(data.states ?? []);
    } catch {
      toast({ title: "Error", description: "Failed to load states", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isSuperAdmin) loadStates();
  }, [isSuperAdmin, loadStates]);

  const handleCreate = async () => {
    if (!form.stateCode || !form.stateName) {
      toast({ title: "Missing fields", description: "State code and name are required.", variant: "destructive" });
      return;
    }
    setIsCreating(true);
    try {
      const res = await authorizedFetch("/api/admin/states", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Create failed");
      toast({ title: "State added", description: `${form.stateName} (${form.stateCode.toUpperCase()}) has been added.` });
      setDialogOpen(false);
      setForm({ stateCode: "", stateName: "", adminEmail: "" });
      loadStates();
    } catch {
      toast({ title: "Error", description: "Failed to add state", variant: "destructive" });
    } finally {
      setIsCreating(false);
    }
  };

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="State Management" backHref="/settings" />
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Super admin access required to manage states.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="State Management"
        description="Manage multi-state configurations and Kerala backfill migration"
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Add State
          </Button>
        }
      />

      {/* Active States */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Active States</h3>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {states.map((state, idx) => (
              <Card key={state.id ?? idx}>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-blue-pale shrink-0">
                    <Globe className="h-5 w-5 text-brand-blue" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">{state.stateCode}</p>
                    {state.stateName && (
                      <p className="text-xs text-muted-foreground truncate">{state.stateName}</p>
                    )}
                    {state.stateCode === "KL" && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-brand-blue/10 text-brand-blue mt-0.5">
                        Primary
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
            {states.length === 0 && (
              <Card className="col-span-full">
                <CardContent className="py-10 text-center">
                  <Globe className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
                  <p className="text-sm text-muted-foreground">No states configured yet.</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Migration Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-brand-gold" />
            Kerala Backfill Migration
          </CardTitle>
          <CardDescription>
            Adds <code className="text-xs bg-muted px-1 py-0.5 rounded">stateCode: &apos;KL&apos;</code> to all existing Firestore documents that are missing this field.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg bg-muted p-4">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Run the migration script:</p>
            <pre className="text-xs font-mono overflow-x-auto">
              {"FIREBASE_ADMIN_SDK_CONFIG_BASE64=<base64-encoded-json> \\\n  ts-node scripts/migrate-add-state-code.ts"}
            </pre>
          </div>
          <p className="text-xs text-muted-foreground">
            The script is idempotent — it only sets <code className="bg-muted px-1 rounded">stateCode</code> on documents where it is missing.
            Safe to run multiple times. Uses batched writes (max 499 per batch).
          </p>
          <p className="text-xs text-muted-foreground">
            Collections covered: employees, attendanceLogs, clients, sites, clientLocations,
            workOrders, fieldOfficers, clientUsers, attendanceState, trainingModules,
            trainingAssignments, evaluations, guardScores, awards, clientWageConfig,
            salaryStructures, employeeSalaries, payrollCycles, payrollEntries, leaveRequests,
            leaveBalances, foVisitReports, foTrainingReports, branchExpenses, branches.
          </p>
        </CardContent>
      </Card>

      {/* Add State Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New State</DialogTitle>
            <DialogDescription>Configure a new state for multi-state operations</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>State Code * (2 characters)</Label>
              <Input
                value={form.stateCode}
                onChange={(e) => setForm((f) => ({ ...f, stateCode: e.target.value.toUpperCase() }))}
                maxLength={2}
                placeholder="e.g. MH"
              />
            </div>
            <div className="space-y-1.5">
              <Label>State Name *</Label>
              <Input
                value={form.stateName}
                onChange={(e) => setForm((f) => ({ ...f, stateName: e.target.value }))}
                placeholder="e.g. Maharashtra"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Admin Email (optional)</Label>
              <Input
                type="email"
                value={form.adminEmail}
                onChange={(e) => setForm((f) => ({ ...f, adminEmail: e.target.value }))}
                placeholder="state-admin@example.com"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={isCreating}>
                {isCreating ? "Adding..." : "Add State"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
