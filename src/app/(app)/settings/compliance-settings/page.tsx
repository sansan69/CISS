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
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import { Trash2, Plus, RotateCcw } from "lucide-react";
import type { ComplianceSettings, PTSlab, TDSSlab } from "@/types/payroll";

const KERALA_DEFAULTS: ComplianceSettings = {
  epf: { employeeRate: 0.12, employerEpsRate: 0.0833, employerEpfRate: 0.0367, wageCeiling: 15000, maxEmployerContribution: 1800 },
  esic: { employeeRate: 0.0075, employerRate: 0.0325, grossWageCeiling: 21000 },
  professionalTax: { state: "Kerala", slabs: [{ upTo: 11999, monthly: 0 }, { upTo: 17999, monthly: 120 }, { upTo: 29999, monthly: 180 }, { upTo: null, monthly: 200 }] },
  tds: { regime: "new", standardDeduction: 75000, slabs: [{ upTo: 300000, rate: 0 }, { upTo: 700000, rate: 0.05 }, { upTo: 1000000, rate: 0.10 }, { upTo: 1200000, rate: 0.15 }, { upTo: 1500000, rate: 0.20 }, { upTo: null, rate: 0.30 }] },
  bonus: { rate: 0.0833, minimumWageBase: 7000 },
  gratuity: { rate: 0.0481, minimumYearsForPayout: 5 },
};

export default function ComplianceSettingsPage() {
  const router = useRouter();
  const { userRole } = useAppAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<ComplianceSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (userRole !== null && userRole !== "admin" && userRole !== "superAdmin") {
      router.replace("/dashboard");
    }
  }, [userRole, router]);

  const loadSettings = useCallback(async () => {
    try {
      const res = await authorizedFetch("/api/admin/compliance-settings");
      const data = await res.json();
      setSettings(data);
    } catch {
      toast({ title: "Error", description: "Failed to load settings", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const save = async (section: string) => {
    if (!settings) return;
    setSaving(section);
    try {
      const res = await authorizedFetch("/api/admin/compliance-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error("Save failed");
      toast({ title: "Saved", description: `${section} settings updated.` });
    } catch {
      toast({ title: "Error", description: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  if (isLoading || !settings) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Compliance Settings" description="Statutory rates for EPF, ESIC, PT, TDS, Bonus & Gratuity" />
        {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-48 w-full" />)}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Compliance Settings"
        description="Statutory rates for EPF, ESIC, PT, TDS, Bonus & Gratuity"
        backHref="/settings"
      />

      {/* EPF */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">EPF — Employee Provident Fund</CardTitle>
          <CardDescription>Contribution rates and wage ceiling</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { label: "Employee Rate %", key: "employeeRate", pct: true },
            { label: "Employer EPS Rate %", key: "employerEpsRate", pct: true },
            { label: "Employer EPF Rate %", key: "employerEpfRate", pct: true },
            { label: "Wage Ceiling ₹", key: "wageCeiling", pct: false },
            { label: "Max Employer Contribution ₹", key: "maxEmployerContribution", pct: false },
          ].map(({ label, key, pct }) => (
            <div key={key} className="space-y-1.5">
              <Label>{label}</Label>
              <Input
                type="number"
                step={pct ? "0.001" : "1"}
                value={pct ? (settings.epf[key as keyof typeof settings.epf] as number) * 100 : settings.epf[key as keyof typeof settings.epf] as number}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setSettings((s) => s ? { ...s, epf: { ...s.epf, [key]: pct ? v / 100 : v } } : s);
                }}
              />
            </div>
          ))}
          <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
            <Button onClick={() => save("EPF")} disabled={saving === "EPF"}>
              {saving === "EPF" ? "Saving..." : "Save EPF"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ESIC */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ESIC — Employee State Insurance</CardTitle>
          <CardDescription>Contribution rates and gross wage ceiling</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: "Employee Rate %", key: "employeeRate", pct: true },
            { label: "Employer Rate %", key: "employerRate", pct: true },
            { label: "Gross Wage Ceiling ₹", key: "grossWageCeiling", pct: false },
          ].map(({ label, key, pct }) => (
            <div key={key} className="space-y-1.5">
              <Label>{label}</Label>
              <Input
                type="number"
                step={pct ? "0.001" : "1"}
                value={pct ? (settings.esic[key as keyof typeof settings.esic] as number) * 100 : settings.esic[key as keyof typeof settings.esic] as number}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setSettings((s) => s ? { ...s, esic: { ...s.esic, [key]: pct ? v / 100 : v } } : s);
                }}
              />
            </div>
          ))}
          <div className="sm:col-span-3 flex justify-end">
            <Button onClick={() => save("ESIC")} disabled={saving === "ESIC"}>
              {saving === "ESIC" ? "Saving..." : "Save ESIC"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Professional Tax */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Professional Tax</CardTitle>
              <CardDescription>State-wise monthly PT slabs</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSettings((s) => s ? { ...s, professionalTax: KERALA_DEFAULTS.professionalTax } : s)}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Reset to Kerala Defaults
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>State</Label>
            <Input
              value={settings.professionalTax.state}
              onChange={(e) => setSettings((s) => s ? { ...s, professionalTax: { ...s.professionalTax, state: e.target.value } } : s)}
            />
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2 text-xs font-medium text-muted-foreground px-1">
              <span>Up To ₹ (blank = no limit)</span>
              <span>Monthly PT ₹</span>
              <span></span>
            </div>
            {settings.professionalTax.slabs.map((slab, i) => (
              <div key={i} className="grid grid-cols-3 gap-2 items-center">
                <Input
                  type="number"
                  placeholder="No limit"
                  value={slab.upTo ?? ""}
                  onChange={(e) => {
                    const slabs = [...settings.professionalTax.slabs];
                    slabs[i] = { ...slabs[i], upTo: e.target.value === "" ? null : parseFloat(e.target.value) };
                    setSettings((s) => s ? { ...s, professionalTax: { ...s.professionalTax, slabs } } : s);
                  }}
                />
                <Input
                  type="number"
                  value={slab.monthly}
                  onChange={(e) => {
                    const slabs = [...settings.professionalTax.slabs];
                    slabs[i] = { ...slabs[i], monthly: parseFloat(e.target.value) };
                    setSettings((s) => s ? { ...s, professionalTax: { ...s.professionalTax, slabs } } : s);
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    const slabs = settings.professionalTax.slabs.filter((_, j) => j !== i);
                    setSettings((s) => s ? { ...s, professionalTax: { ...s.professionalTax, slabs } } : s);
                  }}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const slabs: PTSlab[] = [...settings.professionalTax.slabs, { upTo: null, monthly: 0 }];
                setSettings((s) => s ? { ...s, professionalTax: { ...s.professionalTax, slabs } } : s);
              }}
            >
              <Plus className="h-4 w-4 mr-1.5" /> Add Slab
            </Button>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => save("PT")} disabled={saving === "PT"}>
              {saving === "PT" ? "Saving..." : "Save PT"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* TDS */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">TDS — Tax Deducted at Source</CardTitle>
          <CardDescription>Income tax regime and slab rates</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Regime</Label>
              <Select
                value={settings.tds.regime}
                onValueChange={(v) => setSettings((s) => s ? { ...s, tds: { ...s.tds, regime: v as "new" | "old" } } : s)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New Regime</SelectItem>
                  <SelectItem value="old">Old Regime</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Standard Deduction ₹</Label>
              <Input
                type="number"
                value={settings.tds.standardDeduction}
                onChange={(e) => setSettings((s) => s ? { ...s, tds: { ...s.tds, standardDeduction: parseFloat(e.target.value) } } : s)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2 text-xs font-medium text-muted-foreground px-1">
              <span>Up To ₹ (blank = no limit)</span>
              <span>Rate %</span>
              <span></span>
            </div>
            {settings.tds.slabs.map((slab, i) => (
              <div key={i} className="grid grid-cols-3 gap-2 items-center">
                <Input
                  type="number"
                  placeholder="No limit"
                  value={slab.upTo ?? ""}
                  onChange={(e) => {
                    const slabs = [...settings.tds.slabs];
                    slabs[i] = { ...slabs[i], upTo: e.target.value === "" ? null : parseFloat(e.target.value) };
                    setSettings((s) => s ? { ...s, tds: { ...s.tds, slabs } } : s);
                  }}
                />
                <Input
                  type="number"
                  step="0.01"
                  value={slab.rate * 100}
                  onChange={(e) => {
                    const slabs = [...settings.tds.slabs];
                    slabs[i] = { ...slabs[i], rate: parseFloat(e.target.value) / 100 };
                    setSettings((s) => s ? { ...s, tds: { ...s.tds, slabs } } : s);
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    const slabs = settings.tds.slabs.filter((_, j) => j !== i);
                    setSettings((s) => s ? { ...s, tds: { ...s.tds, slabs } } : s);
                  }}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const slabs: TDSSlab[] = [...settings.tds.slabs, { upTo: null, rate: 0 }];
                setSettings((s) => s ? { ...s, tds: { ...s.tds, slabs } } : s);
              }}
            >
              <Plus className="h-4 w-4 mr-1.5" /> Add Slab
            </Button>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => save("TDS")} disabled={saving === "TDS"}>
              {saving === "TDS" ? "Saving..." : "Save TDS"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Bonus & Gratuity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bonus & Gratuity</CardTitle>
          <CardDescription>Statutory bonus and gratuity provisions</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Bonus Rate %", key: "bonus.rate", pct: true },
            { label: "Min Wage Base ₹", key: "bonus.minimumWageBase", pct: false },
            { label: "Gratuity Rate %", key: "gratuity.rate", pct: true },
            { label: "Min Years for Payout", key: "gratuity.minimumYearsForPayout", pct: false },
          ].map(({ label, key, pct }) => {
            const [section, field] = key.split(".") as ["bonus" | "gratuity", string];
            const rawVal = settings[section][field as keyof typeof settings[typeof section]] as number;
            return (
              <div key={key} className="space-y-1.5">
                <Label>{label}</Label>
                <Input
                  type="number"
                  step={pct ? "0.001" : "1"}
                  value={pct ? rawVal * 100 : rawVal}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setSettings((s) => s ? { ...s, [section]: { ...s[section], [field]: pct ? v / 100 : v } } : s);
                  }}
                />
              </div>
            );
          })}
          <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
            <Button onClick={() => save("Bonus & Gratuity")} disabled={saving === "Bonus & Gratuity"}>
              {saving === "Bonus & Gratuity" ? "Saving..." : "Save Bonus & Gratuity"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {settings.updatedAt && (
        <p className="text-xs text-muted-foreground text-center">
          Last updated by {settings.updatedBy ?? "unknown"}
        </p>
      )}
    </div>
  );
}
