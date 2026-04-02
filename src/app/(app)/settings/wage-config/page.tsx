"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAppAuth } from "@/context/auth-context";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import { Trash2, Plus, Upload, Loader2, Sparkles, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { WageComponent, WageComponentType, CalculationType, ClientWageConfig } from "@/types/payroll";
import { applyWageComponents } from "@/lib/payroll/calculate";

interface Client { id: string; name: string; }

const CALC_LABELS: Record<CalculationType, string> = {
  fixed_amount:    "Fixed ₹",
  pct_of_basic:    "% of Basic",
  pct_of_ctc:      "% of CTC",
  pct_of_gross:    "% of Gross",
  pct_of_epf_base: "% of EPF Base",
  balancing:       "Balancing (auto)",
  kerala_slab:     "Kerala PT Slab",
  tds_projected:   "TDS Projected",
};

const TYPE_COLORS: Record<WageComponentType, string> = {
  earning:               "text-blue-700  border-blue-200  bg-blue-50",
  deduction:             "text-red-700   border-red-200   bg-red-50",
  employer_contribution: "text-amber-700 border-amber-200 bg-amber-50",
};

const TYPE_LABELS: Record<WageComponentType, string> = {
  earning:               "Earning",
  deduction:             "Deduction",
  employer_contribution: "Employer",
};

/** Confidence pill shown on AI-detected components */
function ConfidencePill({ confidence, aiDetected }: { confidence?: number; aiDetected?: boolean }) {
  if (!aiDetected) return null;
  const c = confidence ?? 1;
  const pct = Math.round(c * 100);
  if (c >= 0.9) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-1.5 py-0.5">
        <CheckCircle2 className="h-2.5 w-2.5" />{pct}%
      </span>
    );
  }
  if (c >= 0.7) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-1.5 py-0.5">
        <Sparkles className="h-2.5 w-2.5" />{pct}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
      <AlertTriangle className="h-2.5 w-2.5" />Review
    </span>
  );
}

export default function WageConfigPage() {
  const router      = useRouter();
  const { userRole } = useAppAuth();
  const { toast }   = useToast();

  const [clients, setClients]             = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [components, setComponents]       = useState<WageComponent[]>([]);
  const [isLoading, setIsLoading]         = useState(false);
  const [isSaving, setIsSaving]           = useState(false);
  const [isUploading, setIsUploading]     = useState(false);
  const [activeTab, setActiveTab]         = useState<"upload" | "manual">("upload");
  const [fileRef, setFileRef]             = useState<HTMLInputElement | null>(null);
  const [parserLabel, setParserLabel]     = useState<string | null>(null);
  const [aiUsed, setAiUsed]               = useState(false);
  const [lowConfCount, setLowConfCount]   = useState(0);
  const [configMeta, setConfigMeta]       = useState<Partial<ClientWageConfig> | null>(null);

  useEffect(() => {
    if (userRole !== null && userRole !== "admin" && userRole !== "superAdmin") {
      router.replace("/dashboard");
    }
  }, [userRole, router]);

  useEffect(() => {
    authorizedFetch("/api/admin/clients")
      .then((r) => r.json())
      .then((d) => setClients(d.clients ?? []))
      .catch(() => {});
  }, []);

  const loadConfig = useCallback(async (clientId: string) => {
    setIsLoading(true);
    setParserLabel(null);
    setAiUsed(false);
    setLowConfCount(0);
    try {
      const res  = await authorizedFetch(`/api/admin/clients/${clientId}/wage-config`);
      const data = await res.json();
      setComponents(data.components ?? []);
      setConfigMeta({
        templateMode:       data.templateMode,
        templateLocked:     data.templateLocked,
        sheetTemplate:      data.sheetTemplate,
        lastImportSummary:  data.lastImportSummary,
      });
      setParserLabel(data.lastImportSummary?.parserLabel ?? null);
      setAiUsed(data.lastImportSummary?.aiUsed ?? false);
      setLowConfCount(data.lastImportSummary?.lowConfidenceCount ?? 0);
    } catch {
      setComponents([]);
      setConfigMeta(null);
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
      const res  = await fetch(`/api/admin/clients/${selectedClientId}/wage-config/upload`, {
        method:  "POST",
        headers: { Authorization: `Bearer ${token}` },
        body:    formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Parse failed");
      if (!data.components) throw new Error("No components returned");

      setComponents(data.components);
      setConfigMeta({
        templateMode:      data.templateMode,
        templateLocked:    data.templateLocked,
        sheetTemplate:     data.sheetTemplate,
        lastImportSummary: data.lastImportSummary,
      });
      setParserLabel(data.parserLabel ?? "built-in parser");
      setAiUsed(data.aiUsed ?? false);
      setLowConfCount(data.lowConfidenceCount ?? 0);

      const desc = data.aiUsed
        ? `Gemini AI identified ${data.components.length} components.${data.lowConfidenceCount > 0 ? ` ${data.lowConfidenceCount} need your review (highlighted in amber).` : " All classifications look confident."}`
        : `${data.components.length} components extracted using the built-in parser. Please review.`;

      toast({ title: data.aiUsed ? "AI Parse Complete" : "Parsed", description: desc });
      setActiveTab("manual");
    } catch (err: unknown) {
      toast({ title: "Upload Failed", description: err instanceof Error ? err.message : "Upload failed", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const addComponent = () => {
    setComponents((prev) => [
      ...prev,
      {
        id: `comp_${Date.now()}`,
        name: "",
        type: "earning" as WageComponentType,
        calculationType: "fixed_amount" as CalculationType,
        value: 0,
        isStatutory: false,
        statutoryType: null,
        isTaxable: true,
        epfApplicable: false,
        order: prev.length + 1,
      },
    ]);
  };

  const updateComponent = (idx: number, updates: Partial<WageComponent>) => {
    setComponents((prev) =>
      prev.map((c, i) =>
        i === idx
          ? { ...c, ...updates, aiDetected: c.aiDetected, confidence: undefined }
          : c,
      ),
    );
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
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName:        selectedClient?.name ?? "",
          components,
          uploadedFromExcel: activeTab === "upload",
          templateMode:      configMeta?.templateMode ?? "client_template",
          templateLocked:    configMeta?.templateLocked ?? false,
          sheetTemplate:     configMeta?.sheetTemplate,
          lastImportSummary: configMeta?.lastImportSummary,
        }),
      });
      // Clear AI flags after save — admin has confirmed
      setComponents((prev) => prev.map((c) => ({ ...c, aiDetected: false, confidence: undefined })));
      setLowConfCount(0);
      toast({ title: "Saved", description: "Wage configuration saved for future payroll runs." });
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

  const needsReview = components.filter((c) => c.aiDetected && (c.confidence ?? 1) < 0.7);

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Client Wage Configuration"
          description="Upload or manually define the salary component structure for each client"
          backHref="/settings"
        />

        {/* Client selector */}
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
            {/* Tab bar */}
            <div className="flex gap-0 border-b border-border">
              {(["upload", "manual"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                    activeTab === tab
                      ? "border-brand-blue text-brand-blue"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab === "upload" ? "Upload Excel" : "Review & Edit"}
                </button>
              ))}
            </div>

            {/* ── Upload tab ─────────────────────────────────────────────── */}
            {activeTab === "upload" && (
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle className="text-base">Upload Wage Sheet</CardTitle>
                      <CardDescription className="mt-1">
                        Any format — government wage order, HR breakup, client Excel. Gemini AI will extract the components.
                      </CardDescription>
                    </div>
                    <Badge variant="outline" className="shrink-0 gap-1 text-purple-700 border-purple-200 bg-purple-50">
                      <Sparkles className="h-3 w-3" /> AI-Powered
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div
                    className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                      isUploading
                        ? "border-brand-blue/40 bg-brand-blue/5"
                        : "border-border hover:border-brand-blue/50"
                    }`}
                    onClick={() => !isUploading && fileRef?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const file = e.dataTransfer.files[0];
                      if (file && !isUploading) handleFileUpload(file);
                    }}
                  >
                    {isUploading ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-6 w-6 animate-spin text-brand-blue" />
                          <Sparkles className="h-5 w-5 text-purple-500 animate-pulse" />
                        </div>
                        <p className="text-sm font-medium text-brand-blue">Gemini AI is reading the wage sheet…</p>
                        <p className="text-xs text-muted-foreground">Identifying components, types, statutory flags, and values</p>
                      </div>
                    ) : (
                      <>
                        <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
                        <p className="text-sm font-medium">Drop Excel / CSV here or click to browse</p>
                        <p className="text-xs text-muted-foreground mt-1">Supports .xlsx · .xls · .csv — any column order or language</p>
                      </>
                    )}
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      ref={(el) => setFileRef(el)}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload(file);
                        // reset so the same file can be re-uploaded
                        e.target.value = "";
                      }}
                    />
                  </div>

                  {/* How it works */}
                  <div className="rounded-xl bg-muted/40 p-4 space-y-1.5 text-xs text-muted-foreground">
                    <p className="font-semibold text-foreground text-sm mb-2 flex items-center gap-1.5">
                      <Info className="h-4 w-4" /> How it works
                    </p>
                    <p>1. Upload any wage sheet — no fixed template required</p>
                    <p>2. Gemini AI reads every row and identifies component names, types, and values</p>
                    <p>3. Each component gets a confidence score — low-confidence ones are flagged amber for your review</p>
                    <p>4. You review and correct on the next tab, then save</p>
                    <p>5. Next month, re-upload with updated values — the client template is preserved</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── Review & Edit tab ──────────────────────────────────────── */}
            {activeTab === "manual" && (
              <>
                {/* Review banner if AI flagged low-confidence items */}
                {needsReview.length > 0 && (
                  <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-amber-800">
                        {needsReview.length} component{needsReview.length > 1 ? "s" : ""} need your review
                      </p>
                      <p className="text-xs text-amber-700 mt-0.5">
                        Highlighted rows below had ambiguous data in the sheet. Verify the type and value before saving.
                      </p>
                    </div>
                  </div>
                )}

                {/* AI / parser info bar */}
                {parserLabel && (
                  <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    <span>Extracted by:</span>
                    <Badge
                      variant="outline"
                      className={aiUsed
                        ? "gap-1 text-purple-700 border-purple-200 bg-purple-50"
                        : "gap-1"
                      }
                    >
                      {aiUsed && <Sparkles className="h-3 w-3" />}
                      {parserLabel}
                    </Badge>
                    {configMeta?.templateLocked && (
                      <span className="text-xs">
                        Client template saved — future uploads will preserve your edits.
                      </span>
                    )}
                  </div>
                )}

                {/* Component table */}
                {isLoading ? (
                  <div className="space-y-2">
                    {[1,2,3,4].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
                  </div>
                ) : (
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">
                          Components
                          <span className="ml-2 text-sm font-normal text-muted-foreground">
                            ({components.length})
                          </span>
                        </CardTitle>
                        <Button variant="outline" size="sm" onClick={addComponent}>
                          <Plus className="h-4 w-4 mr-1.5" /> Add Row
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 p-3 pt-0 md:p-6 md:pt-0">
                      {/* Column headers — desktop only */}
                      <div className="hidden md:grid grid-cols-[auto_1.8fr_1fr_1.6fr_1fr_auto] gap-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wide px-2 pt-2 pb-1">
                        <span className="w-6" />
                        <span>Component Name</span>
                        <span>Type</span>
                        <span>Calc Method</span>
                        <span>Value / Rate</span>
                        <span />
                      </div>

                      {components.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-8">
                          No components yet. Upload an Excel sheet or add one manually.
                        </p>
                      ) : (
                        components.map((comp, i) => {
                          const isLowConf = comp.aiDetected && (comp.confidence ?? 1) < 0.7;
                          return (
                            <div
                              key={comp.id}
                              className={`grid grid-cols-1 md:grid-cols-[auto_1.8fr_1fr_1.6fr_1fr_auto] gap-2 items-start md:items-center rounded-xl p-3 md:px-2 transition-colors ${
                                isLowConf
                                  ? "bg-amber-50 border border-amber-200"
                                  : "border border-transparent hover:bg-muted/30"
                              }`}
                            >
                              {/* Confidence pill */}
                              <div className="hidden md:flex items-center justify-center w-6">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span>
                                      <ConfidencePill confidence={comp.confidence} aiDetected={comp.aiDetected} />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="right" className="text-xs">
                                    {comp.aiDetected
                                      ? `AI confidence: ${Math.round((comp.confidence ?? 1) * 100)}%${(comp.confidence ?? 1) < 0.7 ? " — please verify" : ""}`
                                      : "Manually added"}
                                  </TooltipContent>
                                </Tooltip>
                              </div>

                              {/* Name + mobile confidence */}
                              <div className="flex items-center gap-2">
                                <div className="md:hidden">
                                  <ConfidencePill confidence={comp.confidence} aiDetected={comp.aiDetected} />
                                </div>
                                <Input
                                  value={comp.name}
                                  placeholder="Component name (e.g. Basic Salary)"
                                  className={isLowConf ? "border-amber-300 focus-visible:ring-amber-400" : ""}
                                  onChange={(e) => updateComponent(i, { name: e.target.value })}
                                />
                              </div>

                              {/* Type */}
                              <Select
                                value={comp.type}
                                onValueChange={(v) => updateComponent(i, { type: v as WageComponentType })}
                              >
                                <SelectTrigger className={isLowConf ? "border-amber-300" : ""}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {(Object.entries(TYPE_LABELS) as [WageComponentType, string][]).map(([k, v]) => (
                                    <SelectItem key={k} value={k}>
                                      <span className={`inline-flex items-center text-xs font-medium rounded-full px-2 py-0.5 border ${TYPE_COLORS[k]}`}>
                                        {v}
                                      </span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>

                              {/* Calc method */}
                              <Select
                                value={comp.calculationType}
                                onValueChange={(v) => updateComponent(i, { calculationType: v as CalculationType })}
                              >
                                <SelectTrigger className={isLowConf ? "border-amber-300" : ""}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {(Object.entries(CALC_LABELS) as [CalculationType, string][]).map(([k, v]) => (
                                    <SelectItem key={k} value={k}>{v}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>

                              {/* Value */}
                              <Input
                                type="number"
                                placeholder={
                                  comp.calculationType === "balancing"       ? "Auto"   :
                                  comp.calculationType === "kerala_slab"     ? "Slab"   :
                                  comp.calculationType === "tds_projected"   ? "Auto"   :
                                  comp.calculationType.startsWith("pct_")    ? "Rate %" :
                                  "Amount ₹"
                                }
                                disabled={
                                  comp.calculationType === "balancing" ||
                                  comp.calculationType === "kerala_slab" ||
                                  comp.calculationType === "tds_projected"
                                }
                                value={comp.value ?? ""}
                                className={isLowConf ? "border-amber-300" : ""}
                                onChange={(e) => updateComponent(i, { value: parseFloat(e.target.value) || 0 })}
                              />

                              {/* Delete */}
                              <Button variant="ghost" size="icon" onClick={() => removeComponent(i)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          );
                        })
                      )}

                      {/* ── Live payroll preview ─────────────────────────── */}
                      {preview && components.length > 0 && (
                        <div className="mt-4 rounded-xl bg-muted/40 border border-border p-4">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                            Live Preview — ₹15,000 Gross CTC
                          </p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1.5">
                            {Object.entries(preview).map(([id, amount]) => {
                              const comp = components.find((c) => c.id === id);
                              const isDeduction = comp?.type === "deduction";
                              return (
                                <div key={id} className="flex items-center justify-between text-sm gap-2">
                                  <span className="text-muted-foreground truncate text-xs">{comp?.name ?? id}</span>
                                  <span className={`font-medium tabular-nums shrink-0 text-xs ${isDeduction ? "text-red-600" : "text-foreground"}`}>
                                    {isDeduction ? "-" : ""}₹{Math.abs(amount).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* ── Save button ──────────────────────────────────── */}
                      <div className="flex items-center justify-between pt-3 border-t border-border mt-2">
                        <p className="text-xs text-muted-foreground">
                          {needsReview.length > 0
                            ? `${needsReview.length} amber row${needsReview.length > 1 ? "s" : ""} still need review`
                            : components.length > 0 ? "Ready to save" : ""}
                        </p>
                        <Button
                          onClick={save}
                          disabled={isSaving || components.length === 0}
                          className="min-w-32"
                        >
                          {isSaving ? (
                            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</>
                          ) : (
                            "Save Configuration"
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
