"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { authorizedFetch } from "@/lib/api-client";
import { useClients } from "@/lib/hooks/use-clients";
import { useAppAuth } from "@/context/auth-context";
import { cn } from "@/lib/utils";
import type {
  ClientWageConfig,
  ClientWageTemplateSchema,
  WageComponent,
  WageTemplateConstant,
  WageTemplateFieldCategory,
  WageTemplateRule,
  WageTemplateRuleType,
} from "@/types/payroll";
import type { TemplateFieldAnalysis } from "@/lib/payroll/wage-template-parser";

type Stage = "upload" | "review" | "configure";

interface UploadResult {
  sheetNames: string[];
  selectedSheet: string;
  sheetIndex: number;
  headerRowIndex: number;
  headers: string[];
  rows: string[][];
  totalRows: number;
  detectedSheetFamily: ClientWageTemplateSchema["sheetFamily"];
  parserSummary: {
    detectedFields: number;
    attendanceFields: number;
    earningFields: number;
    deductionFields: number;
  };
  templateFields: TemplateFieldAnalysis[];
}

interface TemplateRuleDraft extends WageTemplateRule {
  keep: boolean;
  ruleHint: string;
  sampleValues: string[];
  availableFormulaSources: Array<"header" | "cell">;
}

const CATEGORY_OPTIONS: WageTemplateFieldCategory[] = [
  "meta",
  "attendance",
  "earning",
  "deduction",
  "employer_contribution",
  "summary",
];

const RULE_TYPE_OPTIONS: { value: WageTemplateRuleType; label: string }[] = [
  { value: "attendance_bound", label: "Attendance Bound" },
  { value: "fixed_amount", label: "Fixed Amount" },
  { value: "per_duty_rate", label: "Per Duty Rate" },
  { value: "percentage_of_component", label: "Percentage of Component" },
  { value: "sum_of_components", label: "Sum of Components" },
  { value: "formula_expression", label: "Formula Expression" },
  { value: "summary_only", label: "Summary Only" },
  { value: "deduction_rule", label: "Deduction Rule" },
  { value: "employer_contribution_rule", label: "Employer Contribution Rule" },
];

const ATTENDANCE_BINDINGS = [
  "payable_duties",
  "duties",
  "weekly_off",
  "extra_duty_days",
  "half_day",
  "total",
  "additional_duties",
];

function humanizeCategory(category: WageTemplateFieldCategory) {
  return category.replace(/_/g, " ");
}

function buildAttendanceKey(field: TemplateFieldAnalysis) {
  if (!field.attendanceBound) return null;
  if (field.standardName.includes("payable_duties")) return "payable_duties";
  if (field.standardName.includes("weekly_off")) return "weekly_off";
  if (field.standardName.includes("extra_duty")) return "extra_duty_days";
  if (field.standardName.includes("half_day")) return "half_day";
  if (field.standardName.includes("additional")) return "additional_duties";
  if (field.standardName === "total") return "total";
  return "duties";
}

function buildRuleType(field: TemplateFieldAnalysis): WageTemplateRuleType {
  if (field.category === "attendance") return "attendance_bound";
  if (field.category === "summary") return "summary_only";
  if (field.category === "deduction") return "deduction_rule";
  if (field.category === "employer_contribution") return "employer_contribution_rule";
  if (field.formulaSources.length > 0) return "formula_expression";
  return "fixed_amount";
}

function buildExpression(field: TemplateFieldAnalysis, formulaSource: "header" | "cell" | "manual") {
  if (formulaSource === "header") return field.headerFormulaHint;
  if (formulaSource === "cell") return field.sampleCellFormulas[0] ?? null;
  return null;
}

function buildDraft(field: TemplateFieldAnalysis, order: number): TemplateRuleDraft {
  const formulaSource =
    field.formulaSources.includes("header")
      ? "header"
      : field.formulaSources.includes("cell")
        ? "cell"
        : "manual";

  return {
    id: `${field.standardName}_${order}`,
    originalLabel: field.originalLabel,
    displayLabel: field.originalLabel,
    standardName: field.standardName,
    category: field.category,
    ruleType: buildRuleType(field),
    formulaSource,
    expression: buildExpression(field, formulaSource),
    dependsOn: [],
    constantKeys: field.detectedConstants.map((constant) => constant.key),
    attendanceKey: buildAttendanceKey(field),
    summaryOnly: field.category === "summary",
    order,
    keep: !field.likelyIgnored,
    ruleHint: field.ruleHint,
    sampleValues: field.sampleValues,
    availableFormulaSources: field.formulaSources,
  };
}

function dedupeConstants(fields: TemplateFieldAnalysis[]) {
  const byKey = new Map<string, WageTemplateConstant>();
  fields.forEach((field) => {
    field.detectedConstants.forEach((constant) => {
      if (!byKey.has(constant.key)) {
        byKey.set(constant.key, {
          key: constant.key,
          label: constant.key.replace(/_/g, " "),
          value: constant.value,
          source: constant.source,
        });
      }
    });
  });
  return Array.from(byKey.values());
}

export default function WageConfigPage() {
  const router = useRouter();
  const { userRole } = useAppAuth();
  const { toast } = useToast();
  const { clients } = useClients();

  const [selectedClientId, setSelectedClientId] = useState("");
  const [stage, setStage] = useState<Stage>("upload");
  const [fileInputEl, setFileInputEl] = useState<HTMLInputElement | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [checkedFields, setCheckedFields] = useState<Set<number>>(new Set());
  const [templateRules, setTemplateRules] = useState<TemplateRuleDraft[]>([]);
  const [templateConstants, setTemplateConstants] = useState<WageTemplateConstant[]>([]);
  const [savedConfig, setSavedConfig] = useState<ClientWageConfig | null>(null);
  const [savedComponents, setSavedComponents] = useState<WageComponent[]>([]);

  useEffect(() => {
    if (userRole !== null && userRole !== "admin" && userRole !== "superAdmin") {
      router.replace("/dashboard");
    }
  }, [router, userRole]);

  const loadSaved = useCallback(async (clientId: string) => {
    setIsLoading(true);
    try {
      const response = await authorizedFetch(`/api/admin/clients/${clientId}/wage-config`);
      const data = (await response.json()) as ClientWageConfig;
      setSavedConfig(data);
      setSavedComponents(data.components ?? []);
      if (data.templateRules?.length) {
        setTemplateRules(
          data.templateRules.map((rule) => ({
            ...rule,
            keep: true,
            ruleHint: "Previously saved template rule",
            sampleValues: [],
            availableFormulaSources:
              rule.formulaSource === "manual" ? [] : [rule.formulaSource],
          })),
        );
        setTemplateConstants(data.templateConstants ?? []);
        setStage("configure");
      } else {
        setStage("upload");
      }
    } catch {
      setSavedConfig(null);
      setSavedComponents([]);
      setTemplateRules([]);
      setTemplateConstants([]);
      setStage("upload");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedClientId) return;
    setUploadResult(null);
    setCheckedFields(new Set());
    setTemplateRules([]);
    setTemplateConstants([]);
    loadSaved(selectedClientId);
  }, [loadSaved, selectedClientId]);

  const handleFile = async (file: File) => {
    if (!selectedClientId) {
      toast({ title: "Select a client first", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const { getAuth } = await import("firebase/auth");
      const token = await getAuth().currentUser?.getIdToken();
      const response = await fetch(`/api/admin/clients/${selectedClientId}/wage-config/upload`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const data = (await response.json()) as UploadResult & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not read file");

      setUploadResult(data);
      setCheckedFields(
        new Set(
          data.templateFields
            .filter((field) => !field.likelyIgnored)
            .map((field) => field.columnIndex),
        ),
      );
      setStage("review");
      toast({
        title: "Wage sheet analyzed",
        description: `${data.parserSummary.detectedFields} fields detected from ${data.selectedSheet}.`,
      });
    } catch (error: unknown) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Could not analyze file.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const proceedToConfigure = () => {
    if (!uploadResult) return;
    const selectedFields = uploadResult.templateFields
      .filter((field) => checkedFields.has(field.columnIndex))
      .sort((a, b) => a.columnIndex - b.columnIndex);

    if (!selectedFields.length) {
      toast({ title: "Select at least one field", variant: "destructive" });
      return;
    }

    setTemplateRules(selectedFields.map((field, index) => buildDraft(field, index + 1)));
    setTemplateConstants(dedupeConstants(selectedFields));
    setStage("configure");
  };

  const usedConstantKeys = useMemo(
    () =>
      new Set(
        templateRules
          .filter((rule) => rule.keep)
          .flatMap((rule) => rule.constantKeys),
      ),
    [templateRules],
  );

  const save = async () => {
    if (!selectedClientId) return;
    const activeRules = templateRules.filter((rule) => rule.keep);
    if (!activeRules.length) {
      toast({ title: "No rules selected", variant: "destructive" });
      return;
    }

    const client = clients.find((item) => item.id === selectedClientId);
    const templateSchema: ClientWageTemplateSchema | undefined = uploadResult
      ? {
          sheetName: uploadResult.selectedSheet,
          headerRowIndex: uploadResult.headerRowIndex,
          sheetFamily: uploadResult.detectedSheetFamily,
          detectedHeaders: uploadResult.headers,
        }
      : savedConfig?.templateSchema;

    setIsSaving(true);
    try {
      await authorizedFetch(`/api/admin/clients/${selectedClientId}/wage-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: client?.name ?? "",
          components: savedComponents,
          uploadedFromExcel: true,
          templateMode: "client_template",
          templateSchema,
          templateConstants: templateConstants.filter((constant) => usedConstantKeys.has(constant.key)),
          templateRules: activeRules.map(({ keep: _keep, ruleHint: _hint, sampleValues: _samples, availableFormulaSources: _sources, ...rule }) => rule),
          templateVersion: 1,
          lastImportSummary: {
            parserSource: "deterministic",
            parserLabel: "template parser",
            parsedAt: new Date().toISOString(),
            parsedComponents: activeRules.length,
          },
        }),
      });
      toast({ title: "Template saved", description: "Client wage template is ready for payroll setup." });
    } catch (error: unknown) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Could not save client wage template.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Wage Configuration"
        description="Upload a sample wage sheet, review detected fields and formulas, then save a reusable client payroll template."
        backHref="/settings"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Select Client</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedClientId} onValueChange={setSelectedClientId}>
            <SelectTrigger className="max-w-sm">
              <SelectValue placeholder="Choose a client…" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((client) => (
                <SelectItem key={client.id} value={client.id}>
                  {client.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {!selectedClientId && (
        <p className="py-8 text-center text-sm text-muted-foreground">Select a client to begin.</p>
      )}

      {selectedClientId && isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-14 w-full" />
          ))}
        </div>
      )}

      {selectedClientId && !isLoading && (
        <>
          <div className="flex items-center gap-2 text-sm">
            {(["upload", "review", "configure"] as Stage[]).map((item, index) => {
              const active = stage === item;
              const done =
                (stage === "review" && item === "upload") ||
                (stage === "configure" && item !== "configure");

              return (
                <React.Fragment key={item}>
                  <div
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium",
                      active
                        ? "bg-brand-blue text-white"
                        : done
                          ? "bg-green-100 text-green-700"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {done ? (
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        {item}
                      </span>
                    ) : (
                      item
                    )}
                  </div>
                  {index < 2 && <div className="h-px w-4 bg-border" />}
                </React.Fragment>
              );
            })}
          </div>

          {stage === "upload" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Upload Sample Wage Sheet</CardTitle>
                <CardDescription>
                  Upload one standard client wagesheet. The parser will detect header rows, field families, formulas, and reusable constants.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div
                  className={cn(
                    "cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-colors",
                    isUploading ? "border-brand-blue/40 bg-brand-blue/5" : "border-border hover:border-brand-blue/50",
                  )}
                  onClick={() => !isUploading && fileInputEl?.click()}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const file = event.dataTransfer.files[0];
                    if (file && !isUploading) handleFile(file);
                  }}
                >
                  {isUploading ? (
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="h-8 w-8 animate-spin text-brand-blue" />
                      <p className="text-sm font-medium">Analyzing template fields and formulas…</p>
                    </div>
                  ) : (
                    <>
                      <FileSpreadsheet className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                      <p className="text-sm font-medium">Drop Excel file here or click to browse</p>
                      <p className="mt-1 text-xs text-muted-foreground">Supports .xlsx and .xls wage sheets</p>
                    </>
                  )}
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    ref={(element) => setFileInputEl(element)}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) handleFile(file);
                      event.target.value = "";
                    }}
                  />
                </div>

                {savedConfig?.templateRules?.length ? (
                  <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
                    Existing template found with {savedConfig.templateRules.length} saved rules.
                    <Button
                      variant="link"
                      className="ml-2 h-auto p-0 text-sm"
                      onClick={() => setStage("configure")}
                    >
                      Edit saved template
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )}

          {stage === "review" && uploadResult && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Review Detected Fields</CardTitle>
                <CardDescription>
                  Sheet <strong>{uploadResult.selectedSheet}</strong> uses the{" "}
                  <strong>{uploadResult.detectedSheetFamily.replace(/_/g, " ")}</strong> family.
                  Header row detected at line {uploadResult.headerRowIndex + 1}.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                  <div className="rounded-lg border p-3">Fields: {uploadResult.parserSummary.detectedFields}</div>
                  <div className="rounded-lg border p-3">Attendance: {uploadResult.parserSummary.attendanceFields}</div>
                  <div className="rounded-lg border p-3">Earnings: {uploadResult.parserSummary.earningFields}</div>
                  <div className="rounded-lg border p-3">Deductions: {uploadResult.parserSummary.deductionFields}</div>
                </div>

                <div className="rounded-lg border">
                  {uploadResult.templateFields.map((field) => {
                    const checked = checkedFields.has(field.columnIndex);
                    return (
                      <label
                        key={field.columnIndex}
                        className={cn(
                          "flex cursor-pointer gap-3 border-b px-4 py-3 last:border-b-0",
                          checked ? "bg-brand-blue/5" : "hover:bg-muted/20",
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) =>
                            setCheckedFields((previous) => {
                              const next = new Set(previous);
                              if (value) next.add(field.columnIndex);
                              else next.delete(field.columnIndex);
                              return next;
                            })
                          }
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{field.originalLabel}</span>
                            <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                              {humanizeCategory(field.category)}
                            </span>
                            {field.formulaSources.length ? (
                              <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase text-blue-700">
                                {field.formulaSources.join(" + ")}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Standard mapping: <strong>{field.standardName}</strong>
                          </p>
                          <p className="text-xs text-muted-foreground">{field.ruleHint}</p>
                          {field.sampleValues.length ? (
                            <p className="mt-1 text-[11px] text-muted-foreground/80">
                              Sample values: {field.sampleValues.slice(0, 3).join(", ")}
                            </p>
                          ) : null}
                        </div>
                      </label>
                    );
                  })}
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStage("upload")}>
                    <ArrowLeft className="mr-1.5 h-4 w-4" />
                    Back
                  </Button>
                  <Button onClick={proceedToConfigure}>
                    Build Template
                    <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {stage === "configure" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Client Constants</CardTitle>
                  <CardDescription>Edit shared numeric values extracted from the uploaded sheet. These will be reused when payroll runs later.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2">
                  {templateConstants.length ? (
                    templateConstants.map((constant, index) => (
                      <div key={constant.key} className="rounded-lg border p-3">
                        <Label className="mb-1 block text-[11px] uppercase text-muted-foreground">
                          {constant.label}
                        </Label>
                        <Input
                          value={constant.value}
                          type="number"
                          onChange={(event) =>
                            setTemplateConstants((previous) =>
                              previous.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, value: Number(event.target.value || 0), source: "manual" }
                                  : item,
                              ),
                            )
                          }
                        />
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Key: {constant.key} · source: {constant.source}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No constants detected. You can still save manual rules below.</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Template Builder</CardTitle>
                  <CardDescription>
                    Confirm which fields stay, how they map internally, and whether they depend on attendance, constants, or formulas.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {templateRules.map((rule, index) => (
                    <div key={rule.id} className="rounded-xl border p-4">
                      <div className="mb-3 flex items-start gap-3">
                        <Checkbox
                          checked={rule.keep}
                          onCheckedChange={(value) =>
                            setTemplateRules((previous) =>
                              previous.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, keep: !!value } : item,
                              ),
                            )
                          }
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{rule.originalLabel}</span>
                            <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                              {humanizeCategory(rule.category)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{rule.ruleHint}</p>
                          {rule.sampleValues.length ? (
                            <p className="text-[11px] text-muted-foreground/80">
                              Sample values: {rule.sampleValues.slice(0, 3).join(", ")}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <Label className="mb-1 block text-[11px] uppercase text-muted-foreground">Display Label</Label>
                          <Input
                            value={rule.displayLabel}
                            onChange={(event) =>
                              setTemplateRules((previous) =>
                                previous.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, displayLabel: event.target.value } : item,
                                ),
                              )
                            }
                          />
                        </div>
                        <div>
                          <Label className="mb-1 block text-[11px] uppercase text-muted-foreground">Standard Name</Label>
                          <Input
                            value={rule.standardName}
                            onChange={(event) =>
                              setTemplateRules((previous) =>
                                previous.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, standardName: event.target.value } : item,
                                ),
                              )
                            }
                          />
                        </div>
                        <div>
                          <Label className="mb-1 block text-[11px] uppercase text-muted-foreground">Category</Label>
                          <Select
                            value={rule.category}
                            onValueChange={(value) =>
                              setTemplateRules((previous) =>
                                previous.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        category: value as WageTemplateFieldCategory,
                                        summaryOnly: value === "summary",
                                      }
                                    : item,
                                ),
                              )
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CATEGORY_OPTIONS.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {humanizeCategory(option)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="mb-1 block text-[11px] uppercase text-muted-foreground">Rule Type</Label>
                          <Select
                            value={rule.ruleType}
                            onValueChange={(value) =>
                              setTemplateRules((previous) =>
                                previous.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, ruleType: value as WageTemplateRuleType } : item,
                                ),
                              )
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {RULE_TYPE_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="mb-1 block text-[11px] uppercase text-muted-foreground">Formula Source</Label>
                          <Select
                            value={rule.formulaSource}
                            onValueChange={(value) =>
                              setTemplateRules((previous) =>
                                previous.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        formulaSource: value as "header" | "cell" | "manual",
                                      }
                                    : item,
                                ),
                              )
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(["manual", ...rule.availableFormulaSources] as Array<"header" | "cell" | "manual">).map((option) => (
                                <SelectItem key={option} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="mb-1 block text-[11px] uppercase text-muted-foreground">Attendance Binding</Label>
                          <Select
                            value={rule.attendanceKey ?? "__none__"}
                            onValueChange={(value) =>
                              setTemplateRules((previous) =>
                                previous.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        attendanceKey: value === "__none__" ? null : value,
                                      }
                                    : item,
                                ),
                              )
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">None</SelectItem>
                              {ATTENDANCE_BINDINGS.map((binding) => (
                                <SelectItem key={binding} value={binding}>
                                  {binding.replace(/_/g, " ")}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="mt-3">
                        <Label className="mb-1 block text-[11px] uppercase text-muted-foreground">Expression</Label>
                        <Input
                          value={rule.expression ?? ""}
                          placeholder="Formula text or normalized expression"
                          onChange={(event) =>
                            setTemplateRules((previous) =>
                              previous.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, expression: event.target.value || null } : item,
                              ),
                            )
                          }
                        />
                      </div>
                    </div>
                  ))}

                  <div className="flex justify-between border-t pt-4">
                    <Button variant="outline" onClick={() => setStage(uploadResult ? "review" : "upload")}>
                      <ArrowLeft className="mr-1.5 h-4 w-4" />
                      Back
                    </Button>
                    <Button onClick={save} disabled={isSaving || templateRules.length === 0}>
                      {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Save Template
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
