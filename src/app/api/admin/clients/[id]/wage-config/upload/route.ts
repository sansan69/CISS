import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import type { WageComponent, WageComponentType, CalculationType } from "@/types/payroll";

function slugifyComponent(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function parseNumber(input: unknown) {
  if (typeof input === "number") return input;
  if (typeof input !== "string") return null;
  const cleaned = input.replace(/[,%₹\s]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferType(name: string): WageComponentType {
  const normalized = slugifyComponent(name);
  if (
    normalized.includes("epf") ||
    normalized.includes("esic") ||
    normalized.includes("professional_tax") ||
    normalized.includes("tds") ||
    normalized.includes("deduction")
  ) {
    return "deduction";
  }
  if (normalized.includes("employer")) return "employer_contribution";
  return "earning";
}

function inferCalcType(name: string): CalculationType {
  const normalized = slugifyComponent(name);
  if (normalized.includes("epf")) return "pct_of_epf_base";
  if (normalized.includes("esic")) return "pct_of_gross";
  if (normalized.includes("hra")) return "pct_of_basic";
  if (normalized.includes("special")) return "balancing";
  if (normalized.includes("percentage") || normalized.includes("percent")) return "pct_of_ctc";
  return "fixed_amount";
}

function inferStatutoryType(name: string) {
  const normalized = slugifyComponent(name);
  if (normalized.includes("epf")) return "epf";
  if (normalized.includes("esic")) return "esic";
  if (normalized.includes("professional_tax")) return "pt";
  if (normalized.includes("tds")) return "tds";
  return null;
}

function isLikelyComponentName(value: unknown) {
  return typeof value === "string" && /[a-zA-Z]/.test(value) && value.trim().length > 1;
}

function normalizeComponent(name: string, value: number | null, order: number): WageComponent {
  const normalized = slugifyComponent(name);
  const statutoryType = inferStatutoryType(name);
  const calculationType =
    normalized.includes("special") && (value === null || value === 0)
      ? "balancing"
      : inferCalcType(name);

  return {
    id: normalized,
    name: name.trim(),
    type: inferType(name),
    calculationType,
    value: calculationType === "balancing" ? null : value ?? 0,
    isStatutory: statutoryType !== null,
    statutoryType,
    isTaxable: statutoryType === null,
    epfApplicable: normalized.includes("basic") || normalized === "da" || normalized.includes("dearness"),
    order,
  };
}

function extractNameAndValueFromRow(row: unknown[]): { name: string; value: number | null } | null {
  const stringValues = row.filter(isLikelyComponentName) as string[];
  const name = stringValues[0]?.trim();
  if (!name) return null;

  const numeric = row
    .map(parseNumber)
    .find((candidate) => candidate !== null);

  return { name, value: numeric ?? null };
}

function parseTabularRows(matrix: unknown[][]): WageComponent[] {
  const components: WageComponent[] = [];

  for (const row of matrix) {
    const parsed = extractNameAndValueFromRow(row);
    if (!parsed) continue;
    const id = slugifyComponent(parsed.name);
    if (!id || components.some((component) => component.id === id)) continue;
    components.push(normalizeComponent(parsed.name, parsed.value, components.length + 1));
  }

  return components;
}

function parseColumnMajor(matrix: unknown[][]): WageComponent[] {
  const headers = (matrix[0] ?? []).map((value) => String(value).trim().toLowerCase());
  const nameIndex = headers.findIndex((header) =>
    ["component", "component name", "name", "earnings / deductions", "salary head", "particulars"].includes(header),
  );
  const valueIndex = headers.findIndex((header) =>
    ["amount", "value", "monthly rate", "rate", "fixed", "percentage", "%"].includes(header),
  );

  if (nameIndex < 0) return [];

  const components: WageComponent[] = [];
  for (const row of matrix.slice(1)) {
    const name = String(row[nameIndex] ?? "").trim();
    if (!name) continue;
    const value = valueIndex >= 0 ? parseNumber(row[valueIndex]) : null;
    const id = slugifyComponent(name);
    if (!id || components.some((component) => component.id === id)) continue;
    components.push(normalizeComponent(name, value, components.length + 1));
  }

  return components;
}

function parseSheetDeterministically(matrix: unknown[][]): WageComponent[] {
  const tabular = parseColumnMajor(matrix);
  const fallback = parseTabularRows(matrix);
  const winner = tabular.length >= fallback.length ? tabular : fallback;

  if (!winner.some((component) => component.calculationType === "balancing")) {
    winner.push(normalizeComponent("Special Allowance", null, winner.length + 1));
    winner[winner.length - 1].calculationType = "balancing";
    winner[winner.length - 1].value = null;
  }

  return winner;
}

function fallbackParseComponents(rows: Record<string, unknown>[]): WageComponent[] {
  const components: WageComponent[] = [];

  for (const row of rows) {
    const rowValues = Object.values(row);
    const name = rowValues.find((value) => typeof value === "string" && value.trim()) as string | undefined;
    const numeric = rowValues.map(parseNumber).find((value) => value !== null);
    if (!name) continue;

    const normalized = slugifyComponent(name);
    if (!normalized || components.some((component) => component.id === normalized)) continue;

    components.push(normalizeComponent(name, numeric ?? 0, components.length + 1));
  }

  if (!components.some((component) => component.calculationType === "balancing")) {
    components.push(normalizeComponent("Special Allowance", null, components.length + 1));
    components[components.length - 1].calculationType = "balancing";
    components[components.length - 1].value = null;
  }

  return components;
}

function sanitizeParsedComponents(components: WageComponent[]) {
  const deduped: WageComponent[] = [];
  for (const component of components) {
    const normalizedName = component.name?.trim();
    const id = slugifyComponent(component.id || normalizedName || "");
    if (!normalizedName || !id || deduped.some((entry) => entry.id === id)) continue;
    deduped.push({
      ...normalizeComponent(normalizedName, component.value, deduped.length + 1),
      type: component.type || inferType(normalizedName),
      calculationType:
        component.calculationType ||
        (component.value == null ? "balancing" : inferCalcType(normalizedName)),
      value:
        component.calculationType === "balancing" || component.value == null
          ? null
          : component.value,
      isStatutory: component.isStatutory ?? inferStatutoryType(normalizedName) !== null,
      statutoryType: component.statutoryType ?? inferStatutoryType(normalizedName),
      isTaxable: component.isTaxable ?? true,
      epfApplicable: component.epfApplicable ?? false,
      order: deduped.length + 1,
    });
  }

  if (!deduped.some((component) => component.calculationType === "balancing")) {
    deduped.push(normalizeComponent("Special Allowance", null, deduped.length + 1));
    deduped[deduped.length - 1].calculationType = "balancing";
    deduped[deduped.length - 1].value = null;
  }

  return deduped;
}

function parserLabel(source: "template" | "deterministic") {
  if (source === "template") return "client template";
  return "built-in parser";
}

function buildFallbackMatrix(rows: Record<string, unknown>[]) {
  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  );
  const body = rows.map((row) => headers.map((header) => row[header] ?? ""));
  return [headers, ...body];
}

function detectSheetTemplate(matrix: unknown[][]) {
  const headerRow = (matrix[0] ?? []).map((value) => String(value ?? "").trim()).filter(Boolean);
  const normalizedHeaders = headerRow.map((value) => value.toLowerCase());
  const componentHeader = headerRow.find((_, index) =>
    ["component", "component name", "name", "earnings / deductions", "salary head", "particulars"].includes(normalizedHeaders[index]),
  );
  const valueHeader = headerRow.find((_, index) =>
    ["amount", "value", "monthly rate", "rate", "fixed", "percentage", "%"].includes(normalizedHeaders[index]),
  );

  return {
    orientation: componentHeader ? "column" as const : "row" as const,
    componentColumn: componentHeader,
    valueColumn: valueHeader,
    detectedHeaders: headerRow,
  };
}

function mergeWithExistingTemplate(parsedComponents: WageComponent[], existingComponents: WageComponent[]) {
  const existingById = new Map(existingComponents.map((component) => [component.id, component]));
  const existingByName = new Map(existingComponents.map((component) => [slugifyComponent(component.name), component]));
  const merged: WageComponent[] = [];

  for (const parsed of parsedComponents) {
    const match = existingById.get(parsed.id) ?? existingByName.get(slugifyComponent(parsed.name));
    if (match) {
      merged.push({
        ...parsed,
        id: match.id,
        name: match.name,
        type: match.type,
        calculationType: match.calculationType,
        value: match.calculationType === "balancing" ? null : parsed.value ?? match.value ?? 0,
        isStatutory: match.isStatutory,
        statutoryType: match.statutoryType,
        isTaxable: match.isTaxable,
        epfApplicable: match.epfApplicable,
        order: match.order,
      });
      continue;
    }

    merged.push({
      ...parsed,
      order: merged.length + 1,
    });
  }

  for (const existing of existingComponents) {
    if (!merged.some((component) => component.id === existing.id)) {
      merged.push({
        ...existing,
        order: existing.order || merged.length + 1,
      });
    }
  }

  return merged
    .sort((a, b) => a.order - b.order)
    .map((component, index) => ({
      ...component,
      order: index + 1,
    }));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request);
    const { id: clientId } = await params;

    const formData = await request.formData();
    const file = formData.get("file") as File;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const existingConfigSnapshot = await adminDb.collection("clientWageConfig").doc(clientId).get();
    const existingComponents = Array.isArray(existingConfigSnapshot.data()?.components)
      ? sanitizeParsedComponents(existingConfigSnapshot.data()!.components as WageComponent[])
      : [];

    let parserSource: "template" | "deterministic" = existingComponents.length > 0 ? "template" : "deterministic";
    const deterministicComponents = sanitizeParsedComponents(
      parseSheetDeterministically(Array.isArray(matrix) ? matrix : buildFallbackMatrix(rows)),
    );
    const baseComponents =
      deterministicComponents.length > 0
        ? deterministicComponents
        : fallbackParseComponents(rows as Record<string, unknown>[]);
    const components =
      existingComponents.length > 0
        ? mergeWithExistingTemplate(baseComponents, existingComponents)
        : baseComponents;
    const sheetTemplate = detectSheetTemplate(Array.isArray(matrix) ? matrix : buildFallbackMatrix(rows));

    return NextResponse.json({
      components,
      templateMode: "client_template",
      templateLocked: existingComponents.length > 0,
      sheetTemplate,
      lastImportSummary: {
        parserSource,
        parserLabel: parserLabel(parserSource),
        parsedAt: new Date().toISOString(),
        parsedComponents: components.length,
      },
      usedFallbackParser: parserSource === "deterministic",
      parserSource,
      parserLabel: parserLabel(parserSource),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error parsing file";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
