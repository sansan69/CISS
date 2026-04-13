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
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import { useClients } from "@/lib/hooks/use-clients";
import {
  Trash2, Plus, Upload, Loader2, ArrowRight, ArrowLeft,
  FileSpreadsheet, CheckCircle2, Eye, EyeOff, Pencil, RotateCcw,
} from "lucide-react";
import type { WageComponent, WageComponentType, CalculationType } from "@/types/payroll";
import type { ColumnAnalysis } from "@/app/api/admin/clients/[id]/wage-config/upload/route";
import { applyWageComponents } from "@/lib/payroll/calculate";
import { cn } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

const CALC_OPTIONS: { value: CalculationType; label: string; hint: string }[] = [
  { value: "fixed_amount",    label: "Fixed ₹",          hint: "Fixed monthly rupee amount" },
  { value: "pct_of_basic",    label: "% of Basic",        hint: "Percentage of basic salary" },
  { value: "pct_of_ctc",      label: "% of CTC",          hint: "Percentage of total CTC" },
  { value: "pct_of_gross",    label: "% of Gross",        hint: "Percentage of gross earnings" },
  { value: "pct_of_epf_base", label: "% of EPF Base",     hint: "Percentage of EPF-applicable wage" },
  { value: "balancing",       label: "Balancing (auto)",  hint: "Auto-fills to make gross = CTC" },
  { value: "kerala_slab",     label: "Kerala PT Slab",    hint: "Professional tax per Kerala slabs" },
  { value: "tds_projected",   label: "TDS Projected",     hint: "Annual projected tax ÷ 12 months" },
];

const TYPE_OPTIONS: { value: WageComponentType; label: string; color: string }[] = [
  { value: "earning",               label: "Earning",   color: "text-blue-700 bg-blue-50 border-blue-200" },
  { value: "deduction",             label: "Deduction", color: "text-red-700 bg-red-50 border-red-200" },
  { value: "employer_contribution", label: "Employer",  color: "text-amber-700 bg-amber-50 border-amber-200" },
];

function slugify(v: string) {
  return v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function isAutoCalc(ct: CalculationType) {
  return ct === "balancing" || ct === "kerala_slab" || ct === "tds_projected";
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface UploadResult {
  sheetNames: string[];
  selectedSheet: string;
  sheetIndex: number;
  headers: string[];
  rows: string[][];
  totalRows: number;
  columnAnalysis: ColumnAnalysis[];
}

// Per-component editor state (used in Stage 3)
interface ComponentDraft extends WageComponent {
  useSheetValue: boolean;   // true = use detectedValue as-is (no custom formula)
  detectedValue: number | null;
  detectedRate: number | null;
  detectedCalcType: CalculationType;
  detectedHint: string;
  isEditing: boolean;       // is the formula editor open
}

type Stage = "upload" | "select" | "configure";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WageConfigPage() {
  const router = useRouter();
  const { userRole } = useAppAuth();
  const { toast } = useToast();

  const [selectedClientId, setSelectedClientId] = useState("");
  const { clients } = useClients();

  const [stage, setStage] = useState<Stage>("upload");
  const [fileInputRef, setFileInputRef] = useState<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading]   = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  // Stage 2: which columns are checked
  const [checkedCols, setCheckedCols] = useState<Set<number>>(new Set());

  // Stage 3: component drafts
  const [drafts, setDrafts]     = useState<ComponentDraft[]>([]);
  const [showPreview, setShowPreview] = useState(true);

  // Existing saved config
  const [savedComponents, setSavedComponents] = useState<WageComponent[]>([]);
  const [isLoading, setIsLoading]   = useState(false);
  const [isSaving, setIsSaving]     = useState(false);

  useEffect(() => {
    if (userRole !== null && userRole !== "admin" && userRole !== "superAdmin") {
      router.replace("/dashboard");
    }
  }, [userRole, router]);

  const loadSaved = useCallback(async (clientId: string) => {
    setIsLoading(true);
    try {
      const res  = await authorizedFetch(`/api/admin/clients/${clientId}/wage-config`);
      const data = await res.json();
      const loaded: WageComponent[] = data.components ?? [];
      setSavedComponents(loaded);
      if (loaded.length > 0) {
        // Go straight to configure with saved data
        setDrafts(loaded.map(toDraft));
        setStage("configure");
      } else {
        setStage("upload");
      }
    } catch {
      setSavedComponents([]);
      setStage("upload");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedClientId) {
      setUploadResult(null);
      setCheckedCols(new Set());
      setDrafts([]);
      loadSaved(selectedClientId);
    }
  }, [selectedClientId, loadSaved]);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function toDraft(comp: WageComponent): ComponentDraft {
    return {
      ...comp,
      useSheetValue: false,
      detectedValue: comp.value,
      detectedRate: null,
      detectedCalcType: comp.calculationType,
      detectedHint: "Previously saved",
      isEditing: false,
    };
  }

  function colAnalysisToDraft(col: ColumnAnalysis, order: number): ComponentDraft {
    const auto = isAutoCalc(col.detectedCalcType);
    return {
      id: slugify(col.header) || `col_${col.colIndex}`,
      name: col.header,
      type: col.detectedType,
      calculationType: col.detectedCalcType,
      value: auto ? null : col.detectedValue,
      isStatutory: col.detectedCalcType === "pct_of_epf_base" ||
                   col.detectedCalcType === "kerala_slab" ||
                   col.detectedCalcType === "tds_projected" ||
                   col.detectedCalcType === "pct_of_gross",
      statutoryType: null,
      isTaxable: col.detectedType !== "deduction",
      epfApplicable: /basic|da|dearness/.test(slugify(col.header)),
      order,
      // draft-specific
      useSheetValue: !auto && col.detectedValue !== null,
      detectedValue: col.detectedValue,
      detectedRate: col.detectedRate,
      detectedCalcType: col.detectedCalcType,
      detectedHint: col.hint,
      isEditing: false,
    };
  }

  // ── Upload ────────────────────────────────────────────────────────────────────

  const handleFile = async (file: File) => {
    if (!selectedClientId) {
      toast({ title: "Select a client first", variant: "destructive" });
      return;
    }
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { getAuth } = await import("firebase/auth");
      const token = await getAuth().currentUser?.getIdToken();
      const res  = await fetch(
        `/api/admin/clients/${selectedClientId}/wage-config/upload`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not read file");
      setUploadResult(data);
      // Auto-check non-summary columns
      const auto = new Set(
        (data.columnAnalysis as ColumnAnalysis[])
          .filter((c) => !c.isLikelySummary)
          .map((c) => c.colIndex),
      );
      setCheckedCols(auto);
      setStage("select");
      toast({ title: `${data.columnAnalysis.length} columns found`, description: `Sheet: ${data.selectedSheet}` });
    } catch (err: unknown) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  // ── Stage 2 → 3 transition ────────────────────────────────────────────────────

  const proceedToConfigure = () => {
    if (!uploadResult || checkedCols.size === 0) {
      toast({ title: "Select at least one column", variant: "destructive" });
      return;
    }
    const selected = uploadResult.columnAnalysis
      .filter((c) => checkedCols.has(c.colIndex))
      .sort((a, b) => a.colIndex - b.colIndex);

    const newDrafts = selected.map((col, i) => colAnalysisToDraft(col, i + 1));

    // Add a balancing component if none detected
    if (!newDrafts.some((d) => d.calculationType === "balancing")) {
      newDrafts.push({
        id: "special_allowance",
        name: "Special Allowance",
        type: "earning",
        calculationType: "balancing",
        value: null,
        isStatutory: false,
        statutoryType: null,
        isTaxable: true,
        epfApplicable: false,
        order: newDrafts.length + 1,
        useSheetValue: false,
        detectedValue: null,
        detectedRate: null,
        detectedCalcType: "balancing",
        detectedHint: "Auto-balancing — fills remaining CTC",
        isEditing: false,
      });
    }

    setDrafts(newDrafts);
    setStage("configure");
  };

  // ── Draft CRUD ────────────────────────────────────────────────────────────────

  const updateDraft = (idx: number, patch: Partial<ComponentDraft>) => {
    setDrafts((prev) => prev.map((d, i) => i === idx ? { ...d, ...patch } : d));
  };

  const removeDraft = (idx: number) => {
    setDrafts((prev) => prev.filter((_, i) => i !== idx));
  };

  const addDraft = () => {
    setDrafts((prev) => [
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
        useSheetValue: false,
        detectedValue: null,
        detectedRate: null,
        detectedCalcType: "fixed_amount",
        detectedHint: "",
        isEditing: true,
      },
    ]);
  };

  // ── Save ──────────────────────────────────────────────────────────────────────

  const save = async () => {
    if (!selectedClientId) return;
    const invalid = drafts.filter((d) => !d.name.trim());
    if (invalid.length) {
      toast({ title: "Some components have no name", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    const client = clients.find((c) => c.id === selectedClientId);
    const components: WageComponent[] = drafts.map(({ useSheetValue: _u, detectedValue: _dv, detectedRate: _dr, detectedCalcType: _dc, detectedHint: _dh, isEditing: _ie, ...comp }) => comp);
    try {
      await authorizedFetch(`/api/admin/clients/${selectedClientId}/wage-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientName: client?.name ?? "", components, uploadedFromExcel: !!uploadResult, templateMode: "client_template" }),
      });
      setSavedComponents(components);
      toast({ title: "Saved", description: "Wage configuration saved for payroll." });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  // ── Preview ───────────────────────────────────────────────────────────────────

  const previewComponents: WageComponent[] = drafts.map(({ useSheetValue: _u, detectedValue: _dv, detectedRate: _dr, detectedCalcType: _dc, detectedHint: _dh, isEditing: _ie, ...comp }) => comp);
  const preview = selectedClientId && previewComponents.length > 0
    ? applyWageComponents(15000, previewComponents)
    : null;

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Client Wage Configuration"
        description="Upload a wage sheet, select components, and configure each salary formula"
        backHref="/settings"
      />

      {/* Client selector */}
      <Card>
        <CardHeader><CardTitle className="text-base">Select Client</CardTitle></CardHeader>
        <CardContent>
          <Select value={selectedClientId} onValueChange={setSelectedClientId}>
            <SelectTrigger className="max-w-sm">
              <SelectValue placeholder="Choose a client…" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {!selectedClientId && (
        <p className="text-sm text-muted-foreground text-center py-8">Select a client to begin.</p>
      )}

      {selectedClientId && isLoading && (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      )}

      {selectedClientId && !isLoading && (
        <>
          {/* Stage indicator */}
          <div className="flex items-center gap-2 text-sm">
            {(["upload", "select", "configure"] as Stage[]).map((s, i) => {
              const labels: Record<Stage, string> = { upload: "1. Upload", select: "2. Select Columns", configure: "3. Configure" };
              const active = stage === s;
              const done = (stage === "select" && s === "upload") || (stage === "configure" && s !== "configure");
              return (
                <React.Fragment key={s}>
                  <button
                    onClick={() => (done || active) && setStage(s)}
                    className={cn(
                      "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                      active ? "bg-brand-blue text-white" :
                      done   ? "bg-green-100 text-green-700 hover:bg-green-200 cursor-pointer" :
                               "bg-muted text-muted-foreground cursor-default",
                    )}
                  >
                    {done ? <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />{labels[s]}</span> : labels[s]}
                  </button>
                  {i < 2 && <div className="h-px w-4 bg-border" />}
                </React.Fragment>
              );
            })}
          </div>

          {/* ═══ STAGE 1: UPLOAD ════════════════════════════════════════════════ */}
          {stage === "upload" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Upload Wage Sheet</CardTitle>
                <CardDescription>
                  Upload any Excel (.xlsx, .xls) or CSV wage sheet.
                  The system reads the column headings and analyses the values under each one.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div
                  className={cn(
                    "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors",
                    isUploading ? "border-brand-blue/40 bg-brand-blue/5" : "border-border hover:border-brand-blue/50",
                  )}
                  onClick={() => !isUploading && fileInputRef?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && !isUploading) handleFile(f); }}
                >
                  {isUploading ? (
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="h-8 w-8 animate-spin text-brand-blue" />
                      <p className="text-sm font-medium">Reading columns and analysing values…</p>
                    </div>
                  ) : (
                    <>
                      <FileSpreadsheet className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                      <p className="text-sm font-medium">Drop Excel / CSV here or click to browse</p>
                      <p className="text-xs text-muted-foreground mt-1">Supports .xlsx · .xls · .csv</p>
                    </>
                  )}
                  <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                    ref={(el) => setFileInputRef(el)}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
                  />
                </div>

                {savedComponents.length > 0 && (
                  <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span>{savedComponents.length} components already saved for this client.</span>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => { setDrafts(savedComponents.map(toDraft)); setStage("configure"); }}>
                      Edit existing <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ═══ STAGE 2: SELECT COLUMNS ════════════════════════════════════════ */}
          {stage === "select" && uploadResult && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Select Wage Components</CardTitle>
                <CardDescription>
                  Sheet <strong>{uploadResult.selectedSheet}</strong> has {uploadResult.columnAnalysis.length} columns.
                  Tick the ones that are salary components. Summary columns (Gross, Net, Total) are unchecked by default.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Select all / none */}
                <div className="flex items-center gap-3 pb-1">
                  <button className="text-xs text-brand-blue hover:underline"
                    onClick={() => setCheckedCols(new Set(uploadResult.columnAnalysis.map((c) => c.colIndex)))}>
                    Select all
                  </button>
                  <span className="text-muted-foreground text-xs">·</span>
                  <button className="text-xs text-muted-foreground hover:underline" onClick={() => setCheckedCols(new Set())}>
                    Clear
                  </button>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {checkedCols.size} selected
                  </span>
                </div>

                {/* Column list */}
                <div className="divide-y divide-border rounded-lg border overflow-hidden">
                  {uploadResult.columnAnalysis.map((col) => {
                    const checked = checkedCols.has(col.colIndex);
                    const typeOpt = TYPE_OPTIONS.find((t) => t.value === col.detectedType);
                    return (
                      <label
                        key={col.colIndex}
                        className={cn(
                          "flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors",
                          checked ? "bg-brand-blue/5" : col.isLikelySummary ? "bg-muted/30 opacity-60" : "hover:bg-muted/20",
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            setCheckedCols((prev) => {
                              const next = new Set(prev);
                              v ? next.add(col.colIndex) : next.delete(col.colIndex);
                              return next;
                            });
                          }}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{col.header}</span>
                            {typeOpt && (
                              <span className={cn("inline-flex text-[10px] font-medium rounded-full px-2 py-0.5 border", typeOpt.color)}>
                                {typeOpt.label}
                              </span>
                            )}
                            {col.isLikelySummary && (
                              <span className="text-[10px] text-muted-foreground border rounded-full px-2 py-0.5">Summary</span>
                            )}
                          </div>
                          {/* Detected hint */}
                          <p className="text-xs text-muted-foreground mt-0.5">{col.hint}</p>
                          {/* Sample values */}
                          {col.sampleValues.length > 0 && (
                            <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                              Sheet values: {col.sampleValues.slice(0, 3).join(", ")}
                              {col.sampleValues.length > 3 ? "…" : ""}
                            </p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>

                <div className="flex gap-2 pt-2">
                  <Button variant="outline" onClick={() => setStage("upload")}>
                    <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
                  </Button>
                  <Button onClick={proceedToConfigure} disabled={checkedCols.size === 0} className="flex-1 sm:flex-none">
                    Configure {checkedCols.size} component{checkedCols.size !== 1 ? "s" : ""} <ArrowRight className="h-4 w-4 ml-1.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ═══ STAGE 3: CONFIGURE COMPONENTS ═════════════════════════════════ */}
          {stage === "configure" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <CardTitle className="text-base">
                        Configure Components
                        <span className="ml-2 text-sm font-normal text-muted-foreground">({drafts.length})</span>
                      </CardTitle>
                      <CardDescription className="mt-0.5">
                        Review what was detected. Use the sheet value as-is, or open the formula editor to customise.
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      {uploadResult && (
                        <Button variant="outline" size="sm" onClick={() => setStage("select")}>
                          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => setStage("upload")}>
                        <Upload className="h-3.5 w-3.5 mr-1.5" /> Re-upload
                      </Button>
                      <Button variant="outline" size="sm" onClick={addDraft}>
                        <Plus className="h-4 w-4 mr-1.5" /> Add Row
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-3 pt-0 md:p-6 md:pt-0 space-y-3">
                  {drafts.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No components yet. Upload a sheet or click Add Row.
                    </p>
                  ) : (
                    drafts.map((draft, i) => {
                      const typeOpt = TYPE_OPTIONS.find((t) => t.value === draft.type);
                      const hasDetection = draft.detectedHint && draft.detectedHint !== "Previously saved";
                      const auto = isAutoCalc(draft.calculationType);

                      return (
                        <div key={draft.id} className="rounded-xl border border-border p-4 space-y-3 bg-card">
                          {/* Row 1: name + type + delete */}
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <Label className="text-[11px] uppercase text-muted-foreground mb-1 block">Component Name</Label>
                              <Input
                                value={draft.name}
                                placeholder="e.g. Basic Salary"
                                onChange={(e) => updateDraft(i, { name: e.target.value })}
                              />
                            </div>
                            <div className="w-32 shrink-0">
                              <Label className="text-[11px] uppercase text-muted-foreground mb-1 block">Type</Label>
                              <Select value={draft.type} onValueChange={(v) => updateDraft(i, { type: v as WageComponentType })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {TYPE_OPTIONS.map(({ value, label, color }) => (
                                    <SelectItem key={value} value={value}>
                                      <span className={cn("inline-flex text-xs font-medium rounded-full px-2 py-0.5 border", color)}>{label}</span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <Button variant="ghost" size="icon" className="mt-5 h-8 w-8 text-destructive shrink-0" onClick={() => removeDraft(i)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>

                          {/* Row 2: detection card */}
                          {hasDetection && !draft.isEditing && (
                            <div className="rounded-lg border bg-muted/40 px-4 py-3 space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="text-[11px] uppercase font-medium text-muted-foreground mb-0.5">Detected calculation</p>
                                  <p className="text-sm font-medium">{draft.detectedHint}</p>
                                </div>
                                {typeOpt && (
                                  <span className={cn("text-[10px] font-medium rounded-full px-2 py-0.5 border shrink-0 mt-0.5", typeOpt.color)}>
                                    {typeOpt.label}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                {/* Use sheet value button */}
                                {draft.detectedValue !== null && !isAutoCalc(draft.detectedCalcType) && (
                                  <Button
                                    size="sm"
                                    variant={draft.useSheetValue ? "default" : "outline"}
                                    className="h-7 text-xs gap-1.5"
                                    onClick={() => updateDraft(i, {
                                      useSheetValue: true,
                                      calculationType: "fixed_amount",
                                      value: draft.detectedValue,
                                      isEditing: false,
                                    })}
                                  >
                                    {draft.useSheetValue && <CheckCircle2 className="h-3 w-3" />}
                                    Use sheet value — ₹{draft.detectedValue?.toLocaleString("en-IN")}
                                  </Button>
                                )}
                                {/* Use detected formula button (if it's a formula, not just a value) */}
                                {(draft.detectedRate !== null || isAutoCalc(draft.detectedCalcType)) && (
                                  <Button
                                    size="sm"
                                    variant={!draft.useSheetValue && !draft.isEditing ? "default" : "outline"}
                                    className="h-7 text-xs gap-1.5"
                                    onClick={() => updateDraft(i, {
                                      useSheetValue: false,
                                      calculationType: draft.detectedCalcType,
                                      value: isAutoCalc(draft.detectedCalcType)
                                        ? null
                                        : (draft.detectedRate ?? draft.detectedValue ?? 0),
                                      isEditing: false,
                                    })}
                                  >
                                    {!draft.useSheetValue && !draft.isEditing && <CheckCircle2 className="h-3 w-3" />}
                                    Use formula
                                  </Button>
                                )}
                                {/* Edit / Customise */}
                                <Button
                                  size="sm"
                                  variant={draft.isEditing ? "default" : "ghost"}
                                  className="h-7 text-xs gap-1.5 ml-auto"
                                  onClick={() => updateDraft(i, { isEditing: !draft.isEditing, useSheetValue: false })}
                                >
                                  <Pencil className="h-3 w-3" />
                                  {draft.isEditing ? "Done editing" : "Edit / Customise"}
                                </Button>
                              </div>
                            </div>
                          )}

                          {/* Row 3: formula editor (open when isEditing OR no detection) */}
                          {(draft.isEditing || !hasDetection || auto) && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <Label className="text-[11px] uppercase text-muted-foreground mb-1 block">Formula / Calculation</Label>
                                <Select
                                  value={draft.calculationType}
                                  onValueChange={(v) => {
                                    const ct = v as CalculationType;
                                    updateDraft(i, { calculationType: ct, value: isAutoCalc(ct) ? null : (draft.value ?? 0), useSheetValue: false });
                                  }}
                                >
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {CALC_OPTIONS.map(({ value, label, hint }) => (
                                      <SelectItem key={value} value={value}>
                                        <div>
                                          <p className="font-medium text-sm">{label}</p>
                                          <p className="text-xs text-muted-foreground">{hint}</p>
                                        </div>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div>
                                <Label className="text-[11px] uppercase text-muted-foreground mb-1 block">
                                  {auto ? "Value" : draft.calculationType.startsWith("pct_") ? "Rate (%)" : "Amount (₹)"}
                                </Label>
                                <div className="relative">
                                  <Input
                                    type="number"
                                    min={0}
                                    disabled={auto}
                                    placeholder={auto ? "Auto-calculated" : draft.calculationType.startsWith("pct_") ? "e.g. 40" : "e.g. 8000"}
                                    value={draft.value ?? ""}
                                    onChange={(e) => updateDraft(i, { value: parseFloat(e.target.value) || 0, useSheetValue: false })}
                                  />
                                  {/* Reset to sheet value */}
                                  {draft.detectedValue !== null && !auto && (
                                    <button
                                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground hover:text-foreground"
                                      title={`Reset to sheet value ₹${draft.detectedValue}`}
                                      onClick={() => updateDraft(i, { value: draft.detectedValue, useSheetValue: true })}
                                    >
                                      <RotateCcw className="h-3 w-3" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Row 4: checkboxes */}
                          <div className="flex items-center gap-5 text-xs pt-1">
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <Checkbox
                                checked={draft.epfApplicable}
                                onCheckedChange={(v) => updateDraft(i, { epfApplicable: !!v })}
                              />
                              EPF applicable
                            </label>
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <Checkbox
                                checked={draft.isStatutory}
                                onCheckedChange={(v) => updateDraft(i, { isStatutory: !!v })}
                              />
                              Statutory
                            </label>
                          </div>
                        </div>
                      );
                    })
                  )}

                  {/* Live preview */}
                  {preview && drafts.length > 0 && (
                    <div className="mt-2">
                      <button
                        onClick={() => setShowPreview((v) => !v)}
                        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-2"
                      >
                        {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        {showPreview ? "Hide" : "Show"} live preview (₹15,000 CTC)
                      </button>
                      {showPreview && (
                        <div className="rounded-xl bg-muted/40 border p-4">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                            Live Preview — ₹15,000 Gross CTC
                          </p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1.5">
                            {Object.entries(preview).map(([id, amount]) => {
                              const c = drafts.find((x) => x.id === id);
                              const isDeduct = c?.type === "deduction";
                              return (
                                <div key={id} className="flex items-center justify-between text-xs gap-2">
                                  <span className="text-muted-foreground truncate">{c?.name ?? id}</span>
                                  <span className={cn("font-medium tabular-nums shrink-0", isDeduct ? "text-red-600" : "")}>
                                    {isDeduct ? "−" : ""}₹{Math.abs(amount).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Save */}
                  <div className="flex items-center justify-between pt-4 border-t border-border mt-2">
                    <p className="text-xs text-muted-foreground">
                      {drafts.length > 0 ? `${drafts.length} components ready` : "Add components to save"}
                    </p>
                    <Button onClick={save} disabled={isSaving || drafts.length === 0} className="min-w-32">
                      {isSaving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Save Configuration"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
