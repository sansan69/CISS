"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppAuth } from "@/context/auth-context";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import { CheckCircle2, Loader2, Play, ArrowRight, AlertTriangle, Users, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Step = 1 | 2 | 3 | 4 | 5;

interface RunResult {
  cycleId: string;
  totalEmployees: number;
  totalGross: number;
  totalNetPay: number;
  skippedCount: number;
  skippedEmployees: Array<{ name: string; clientId: string | null; reason: string }>;
}

interface ValidationResult {
  totalEmployees: number;
  readyCount: number;
  skippedCount: number;
  skipped: Array<{ id: string; name: string; clientId: string | null; reason: string }>;
  existingCycle: { id: string; status: string } | null;
}

interface Client { id: string; name: string; }

const ALL_CLIENTS_VALUE = "__all_clients__";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function RunPayrollPage() {
  const router = useRouter();
  const { userRole } = useAppAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>(1);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return String(now.getMonth() + 1).padStart(2, "0");
  });
  const [selectedYear, setSelectedYear] = useState<string>(() => String(new Date().getFullYear()));
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [isValidating, setIsValidating] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);

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

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 3 }, (_, i) => String(currentYear - 1 + i));
  const period = `${selectedYear}-${selectedMonth}`;

  const handleValidate = async () => {
    setIsValidating(true);
    setValidation(null);
    try {
      const params = new URLSearchParams({ period });
      if (selectedClientId) params.set("clientId", selectedClientId);
      const res = await authorizedFetch(`/api/admin/payroll/validate?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Validation failed");
      setValidation(data);
      setStep(2);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Validation failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setIsValidating(false);
    }
  };

  const handleRun = async () => {
    setStep(3);
    setIsProcessing(true);
    try {
      const res = await authorizedFetch("/api/admin/payroll/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period,
          ...(selectedClientId ? { clientId: selectedClientId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Payroll run failed");
      setResult(data);
      setStep(5);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Payroll run failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
      setStep(2);
    } finally {
      setIsProcessing(false);
    }
  };

  const steps = [
    { num: 1, label: "Select Period" },
    { num: 2, label: "Review" },
    { num: 3, label: "Processing" },
    { num: 5, label: "Done" },
  ];
  const displaySteps = [1, 2, 3, 5];

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <PageHeader title="Run Payroll" description="Process monthly payroll for employees" backHref="/payroll" />

      {/* Step Indicator */}
      <div className="flex items-center gap-2">
        {displaySteps.map((sNum, i) => {
          const sLabel = steps.find((s) => s.num === sNum)?.label ?? "";
          const isActive = step === sNum || (step === 4 && sNum === 5);
          const isDone = step > sNum || (step === 5 && sNum < 5);
          return (
            <React.Fragment key={sNum}>
              <div className={cn(
                "flex items-center gap-1.5 text-sm",
                isActive ? "text-brand-blue font-medium" : isDone ? "text-green-600 font-medium" : "text-muted-foreground"
              )}>
                <div className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                  isDone ? "bg-green-500 text-white" :
                  isActive ? "bg-brand-blue text-white" :
                  "bg-muted text-muted-foreground"
                )}>
                  {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <span className="hidden sm:inline">{sLabel}</span>
              </div>
              {i < displaySteps.length - 1 && (
                <div className={cn("flex-1 h-px", isDone ? "bg-green-400" : "bg-border")} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Step 1: Select Period */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Select Payroll Period</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Month</Label>
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (
                      <SelectItem key={i} value={String(i + 1).padStart(2, "0")}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Year</Label>
                <Select value={selectedYear} onValueChange={setSelectedYear}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Client Filter (optional)</Label>
              <Select
                value={selectedClientId || ALL_CLIENTS_VALUE}
                onValueChange={(value) => setSelectedClientId(value === ALL_CLIENTS_VALUE ? "" : value)}
              >
                <SelectTrigger><SelectValue placeholder="All clients" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_CLIENTS_VALUE}>All clients</SelectItem>
                  {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Leave empty to run payroll for all active employees.</p>
            </div>

            <Button onClick={handleValidate} className="w-full" disabled={isValidating}>
              {isValidating ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
              {isValidating ? "Checking..." : `Check ${period}`}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Review / Confirm */}
      {step === 2 && validation && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pre-run Review — {period}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Existing cycle warning */}
            {validation.existingCycle && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Cycle already exists</p>
                  <p className="text-xs mt-0.5">
                    A payroll cycle for {period} already exists with status <strong>{validation.existingCycle.status}</strong>.
                    Delete it from the cycle page before re-running.
                  </p>
                </div>
              </div>
            )}

            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border bg-muted/30 p-3 text-center">
                <p className="text-xl font-bold">{validation.totalEmployees}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Total Employees</p>
              </div>
              <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-center">
                <p className="text-xl font-bold text-green-700">{validation.readyCount}</p>
                <p className="text-xs text-green-600 mt-0.5">Ready to Process</p>
              </div>
              <div className={cn(
                "rounded-lg border p-3 text-center",
                validation.skippedCount > 0 ? "border-amber-200 bg-amber-50" : "bg-muted/30"
              )}>
                <p className={cn("text-xl font-bold", validation.skippedCount > 0 ? "text-amber-700" : "")}>
                  {validation.skippedCount}
                </p>
                <p className={cn("text-xs mt-0.5", validation.skippedCount > 0 ? "text-amber-600" : "text-muted-foreground")}>
                  Will be Skipped
                </p>
              </div>
            </div>

            {/* Skipped employees list */}
            {validation.skipped.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-amber-700 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Skipped — no wage config for their client:
                </p>
                <div className="max-h-40 overflow-y-auto rounded-md border border-amber-200 bg-amber-50/50 divide-y divide-amber-100">
                  {validation.skipped.map((emp) => (
                    <div key={emp.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                      <span className="font-medium text-amber-900">{emp.name}</span>
                      <span className="text-amber-600">{emp.reason}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Go to <strong>Settings → Wage Config</strong> to set up the missing configurations, then come back.
                </p>
              </div>
            )}

            {validation.readyCount === 0 && !validation.existingCycle && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <XCircle className="h-4 w-4" />
                No employees ready to process. Set up wage configs first.
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={() => setStep(1)} className="flex-1">
                Back
              </Button>
              <Button
                onClick={handleRun}
                className="flex-1"
                disabled={validation.readyCount === 0 || !!validation.existingCycle}
              >
                <Users className="h-4 w-4 mr-1.5" />
                Process {validation.readyCount} Employees
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Processing */}
      {step === 3 && (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-brand-blue" />
            <div className="text-center">
              <p className="font-semibold">Processing Payroll...</p>
              <p className="text-sm text-muted-foreground mt-1">
                Calculating salaries for {period}
              </p>
              <p className="text-xs text-muted-foreground mt-1">This may take a moment for large teams.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 5: Done */}
      {step === 5 && result && (
        <Card className="border-green-200 bg-green-50/50">
          <CardContent className="py-10 flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-green-800">Payroll Processed!</h3>
              <p className="text-sm text-green-700 mt-1">Period: {period}</p>
            </div>
            <div className="grid grid-cols-3 gap-6 w-full max-w-sm">
              <div>
                <p className="text-2xl font-bold text-green-800">{result.totalEmployees}</p>
                <p className="text-xs text-green-600">Processed</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-800">₹{(result.totalGross / 1000).toFixed(0)}K</p>
                <p className="text-xs text-green-600">Gross</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-800">₹{(result.totalNetPay / 1000).toFixed(0)}K</p>
                <p className="text-xs text-green-600">Net Pay</p>
              </div>
            </div>

            {result.skippedCount > 0 && (
              <div className="w-full max-w-sm rounded-lg border border-amber-200 bg-amber-50 p-3 text-left">
                <p className="text-xs font-medium text-amber-800 flex items-center gap-1 mb-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {result.skippedCount} employee{result.skippedCount > 1 ? "s" : ""} skipped (no wage config):
                </p>
                <div className="space-y-0.5">
                  {result.skippedEmployees.slice(0, 5).map((emp, i) => (
                    <p key={i} className="text-xs text-amber-700">• {emp.name}</p>
                  ))}
                  {result.skippedEmployees.length > 5 && (
                    <p className="text-xs text-amber-600">...and {result.skippedEmployees.length - 5} more</p>
                  )}
                </div>
              </div>
            )}

            <Button onClick={() => router.push(`/payroll/cycles/${result.cycleId}`)}>
              View Cycle <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
