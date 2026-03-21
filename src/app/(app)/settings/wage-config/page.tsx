"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAppAuth } from "@/context/auth-context";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import { Trash2, Plus, Upload, RefreshCw } from "lucide-react";
import type { WageComponent, WageComponentType, CalculationType } from "@/types/payroll";
import { applyWageComponents } from "@/lib/payroll/calculate";

interface Client { id: string; name: string; }

const CALC_LABELS: Record<CalculationType, string> = {
  fixed_amount: "Fixed Amount",
  pct_of_basic: "% of Basic",
  pct_of_ctc: "% of CTC",
  pct_of_gross: "% of Gross",
  pct_of_epf_base: "% of EPF Base",
  balancing: "Balancing",
  kerala_slab: "Kerala Slab",
  tds_projected: "TDS Projected",
};

export default function WageConfigPage() {
  const router = useRouter();
  const { userRole } = useAppAuth();
  const { toast } = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [components, setComponents] = useState<WageComponent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<"upload" | "manual">("upload");
  const [fileRef, setFileRef] = useState<HTMLInputElement | null>(null);

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

  const loadConfig = useCallback(async (clientId: string) => {
    setIsLoading(true);
    try {
      const res = await authorizedFetch(`/api/admin/clients/${clientId}/wage-config`);
      const data = await res.json();
      setComponents(data.components ?? []);
    } catch {
      setComponents([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedClientId) loadConfig(selectedClientId);
  }, [selectedClientId, loadConfig]);

  const handleFileUpload = async (file: File) => {
    if (!selectedClientId) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const { getAuth } = await import("firebase/auth");
      const token = await getAuth().currentUser?.getIdToken();
      const res = await fetch(`/api/admin/clients/${selectedClientId}/wage-config/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (data.components) {
        setComponents(data.components);
        toast({ title: "Parsed", description: `${data.components.length} components extracted by AI.` });
        setActiveTab("manual");
      } else {
        throw new Error(data.error ?? "Parse failed");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const addComponent = () => {
    const newComp: WageComponent = {
      id: `comp_${Date.now()}`,
      name: "",
      type: "earning",
      calculationType: "fixed_amount",
      value: 0,
      isStatutory: false,
      statutoryType: null,
      isTaxable: true,
      epfApplicable: false,
      order: components.length + 1,
    };
    setComponents((prev) => [...prev, newComp]);
  };

  const updateComponent = (idx: number, updates: Partial<WageComponent>) => {
    setComponents((prev) => prev.map((c, i) => i === idx ? { ...c, ...updates } : c));
  };

  const removeComponent = (idx: number) => {
    setComponents((prev) => prev.filter((_, i) => i !== idx));
  };

  const save = async () => {
    if (!selectedClientId) return;
    setIsSaving(true);
    const selectedClient = clients.find((c) => c.id === selectedClientId);
    try {
      await authorizedFetch(`/api/admin/clients/${selectedClientId}/wage-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: selectedClient?.name ?? "",
          components,
          uploadedFromExcel: false,
        }),
      });
      toast({ title: "Saved", description: "Wage configuration saved." });
    } catch {
      toast({ title: "Error", description: "Failed to save", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  // Live preview for ₹15,000 gross
  const preview = selectedClientId && components.length > 0
    ? applyWageComponents(15000, components)
    : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Client Wage Configuration" description="Define salary component structure per client" backHref="/settings" />

      <Card>
        <CardHeader><CardTitle className="text-base">Select Client</CardTitle></CardHeader>
        <CardContent>
          <Select value={selectedClientId} onValueChange={setSelectedClientId}>
            <SelectTrigger className="max-w-sm">
              <SelectValue placeholder="Choose a client..." />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedClientId && (
        <>
          {/* Tab selector */}
          <div className="flex gap-2 border-b border-border pb-0">
            {(["upload", "manual"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? "border-brand-blue text-brand-blue"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab === "upload" ? "Upload Excel" : "Manual"}
              </button>
            ))}
          </div>

          {activeTab === "upload" && (
            <Card>
              <CardHeader><CardTitle className="text-base">Upload Excel Wage Structure</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div
                  className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-brand-blue/50 transition-colors"
                  onClick={() => fileRef?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file) handleFileUpload(file);
                  }}
                >
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm font-medium">Drop Excel file here or click to browse</p>
                  <p className="text-xs text-muted-foreground mt-1">Supports .xlsx, .xls files</p>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    ref={(el) => setFileRef(el)}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file);
                    }}
                  />
                </div>
                {isUploading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Parsing with AI...
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Component Table */}
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Components ({components.length})</CardTitle>
                  <Button variant="outline" size="sm" onClick={addComponent}>
                    <Plus className="h-4 w-4 mr-1.5" /> Add Component
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {components.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No components yet. Add one or upload an Excel file.</p>
                ) : (
                  <>
                    <div className="hidden md:grid grid-cols-[2fr_1fr_1.5fr_1fr_auto] gap-3 text-xs font-medium text-muted-foreground px-1">
                      <span>Name</span><span>Type</span><span>Calc Method</span><span>Value</span><span></span>
                    </div>
                    {components.map((comp, i) => (
                      <div key={comp.id} className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1.5fr_1fr_auto] gap-2 md:gap-3 items-start md:items-center p-3 md:p-0 border md:border-0 rounded-lg md:rounded-none">
                        <Input
                          value={comp.name}
                          placeholder="Component name"
                          onChange={(e) => updateComponent(i, { name: e.target.value })}
                        />
                        <Select value={comp.type} onValueChange={(v) => updateComponent(i, { type: v as WageComponentType })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="earning">Earning</SelectItem>
                            <SelectItem value="deduction">Deduction</SelectItem>
                            <SelectItem value="employer_contribution">Employer</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select value={comp.calculationType} onValueChange={(v) => updateComponent(i, { calculationType: v as CalculationType })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(Object.entries(CALC_LABELS) as [CalculationType, string][]).map(([k, v]) => (
                              <SelectItem key={k} value={k}>{v}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          placeholder="Value"
                          disabled={comp.calculationType === "balancing"}
                          value={comp.value ?? ""}
                          onChange={(e) => updateComponent(i, { value: parseFloat(e.target.value) || 0 })}
                        />
                        <Button variant="ghost" size="icon" onClick={() => removeComponent(i)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </>
                )}

                {/* Live Preview */}
                {preview && (
                  <div className="mt-4 p-4 bg-muted/50 rounded-xl">
                    <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Live Preview — ₹15,000 Gross</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {Object.entries(preview).map(([id, amount]) => {
                        const comp = components.find((c) => c.id === id);
                        return (
                          <div key={id} className="flex justify-between text-sm">
                            <span className="text-muted-foreground truncate">{comp?.name ?? id}</span>
                            <span className="font-medium ml-2">₹{amount.toFixed(2)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <Button onClick={save} disabled={isSaving}>
                    {isSaving ? "Saving..." : "Save Configuration"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Badges legend */}
      {components.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline" className="text-blue-600 border-blue-200">Earning</Badge>
          <Badge variant="outline" className="text-red-600 border-red-200">Deduction</Badge>
          <Badge variant="outline" className="text-amber-600 border-amber-200">Employer</Badge>
        </div>
      )}
    </div>
  );
}
