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
import { CheckCircle2, Loader2, Play, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Step = 1 | 2 | 3 | 4;

interface RunResult {
  cycleId: string;
  totalEmployees: number;
  totalGross: number;
  totalNetPay: number;
}

interface Client { id: string; name: string; }

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
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  useEffect(() => {
    if (userRole !== null && userRole !== "admin") router.replace("/dashboard");
  }, [userRole, router]);

  useEffect(() => {
    authorizedFetch("/api/admin/clients")
      .then((res) => res.json())
      .then((data) => setClients(data.clients ?? []))
      .catch(() => {});
  }, []);

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 3 }, (_, i) => String(currentYear - 1 + i));

  const handleRun = async () => {
    const period = `${selectedYear}-${selectedMonth}`;
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
      setStep(4);
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
    { num: 2, label: "Configure" },
    { num: 3, label: "Processing" },
    { num: 4, label: "Done" },
  ];

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <PageHeader title="Run Payroll" description="Process monthly payroll for employees" backHref="/payroll" />

      {/* Step Indicator */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <React.Fragment key={s.num}>
            <div className={cn(
              "flex items-center gap-1.5 text-sm",
              step >= s.num ? "text-brand-blue font-medium" : "text-muted-foreground"
            )}>
              <div className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                step > s.num ? "bg-green-500 text-white" :
                step === s.num ? "bg-brand-blue text-white" :
                "bg-muted text-muted-foreground"
              )}>
                {step > s.num ? <CheckCircle2 className="h-3.5 w-3.5" /> : s.num}
              </div>
              <span className="hidden sm:inline">{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={cn("flex-1 h-px", step > s.num ? "bg-green-400" : "bg-border")} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Step 1 & 2: Form */}
      {(step === 1 || step === 2) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payroll Period & Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Month</Label>
                <Select value={selectedMonth} onValueChange={(v) => { setSelectedMonth(v); setStep(2); }}>
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
                <Select value={selectedYear} onValueChange={(v) => { setSelectedYear(v); setStep(2); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Client Filter (optional)</Label>
              <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                <SelectTrigger><SelectValue placeholder="All clients" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All clients</SelectItem>
                  {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Leave empty to run payroll for all active employees.</p>
            </div>

            <div className="pt-2">
              <p className="text-sm font-medium mb-1">Period: <span className="text-brand-blue">{selectedYear}-{selectedMonth}</span></p>
              {selectedClientId && (
                <p className="text-sm text-muted-foreground">
                  Client: {clients.find((c) => c.id === selectedClientId)?.name}
                </p>
              )}
            </div>

            <Button onClick={handleRun} className="w-full" disabled={isProcessing}>
              <Play className="h-4 w-4 mr-1.5" />
              Process Payroll for {selectedYear}-{selectedMonth}
            </Button>
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
                Calculating salaries for {selectedYear}-{selectedMonth}
              </p>
              <p className="text-xs text-muted-foreground mt-1">This may take a moment for large teams.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Done */}
      {step === 4 && result && (
        <Card className="border-green-200 bg-green-50/50">
          <CardContent className="py-10 flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-green-800">Payroll Processed!</h3>
              <p className="text-sm text-green-700 mt-1">Period: {selectedYear}-{selectedMonth}</p>
            </div>
            <div className="grid grid-cols-3 gap-6 w-full max-w-sm">
              <div>
                <p className="text-2xl font-bold text-green-800">{result.totalEmployees}</p>
                <p className="text-xs text-green-600">Employees</p>
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
            <Button onClick={() => router.push(`/payroll/cycles/${result.cycleId}`)}>
              View Cycle <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
