import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import type { WageComponent, WageComponentType, CalculationType } from "@/types/payroll";
import { hasOpenRouter, requestOpenRouterJson } from "@/lib/server/openrouter";

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

function buildWageComponentSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      components: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            type: { type: "string", enum: ["earning", "deduction", "employer_contribution"] },
            calculationType: {
              type: "string",
              enum: ["fixed_amount", "pct_of_basic", "pct_of_ctc", "pct_of_gross", "pct_of_epf_base", "balancing", "kerala_slab", "tds_projected"],
            },
            value: { type: ["number", "null"] },
            isStatutory: { type: "boolean" },
            statutoryType: { type: ["string", "null"], enum: ["epf", "esic", "pt", "tds", null] },
            isTaxable: { type: "boolean" },
            epfApplicable: { type: "boolean" },
            order: { type: "integer" },
          },
          required: ["id", "name", "type", "calculationType", "value", "isStatutory", "statutoryType", "isTaxable", "epfApplicable", "order"],
        },
      },
    },
    required: ["components"],
  };
}

async function parseWithOpenRouter(rows: Record<string, unknown>[], deterministic: WageComponent[]) {
  const prompt = [
    "You normalize uploaded payroll wage-sheet structures into a reusable client wage configuration.",
    "Input rows are already extracted from Excel.",
    "Use the deterministic draft as a hint, but correct it if needed.",
    "Return JSON only.",
    "",
    `Deterministic draft: ${JSON.stringify(deterministic, null, 2)}`,
    "",
    `Spreadsheet rows: ${JSON.stringify(rows, null, 2)}`,
    "",
    "Rules:",
    "- Keep ids short and slug-safe.",
    "- Include all meaningful recurring monthly components.",
    "- Use balancing only for the final residual earning component.",
    "- EPF employee should usually be pct_of_epf_base, ESIC employee pct_of_gross, PT kerala_slab, TDS tds_projected.",
    "- Preserve order in a payroll-friendly sequence: earnings first, deductions next, employer contributions last.",
  ].join("\n");

  const result = await requestOpenRouterJson<{ components: WageComponent[] }>({
    prompt,
    schema: buildWageComponentSchema(),
    maxTokens: 1800,
  });

  return result;
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

function parserLabel(source: "deterministic" | "openrouter" | "gemini_fallback") {
  if (source === "openrouter") return "OpenRouter AI";
  if (source === "gemini_fallback") return "legacy AI fallback";
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

function legacyGeminiPrompt(rows: Record<string, unknown>[]) {
  return `You are a payroll configuration expert. Extract a JSON object with a "components" array from the following spreadsheet rows.

Excel data:
${JSON.stringify(rows, null, 2)}

Return ONLY valid JSON matching this structure:
{"components":[{"id":"basic","name":"Basic","type":"earning","calculationType":"fixed_amount","value":5000,"isStatutory":false,"statutoryType":null,"isTaxable":true,"epfApplicable":true,"order":1}]}`;
}

function extractLegacyJson(text: string) {
  const fenced = text.match(/```json\n?([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  return fenced?.[1] ?? text;
}

function inferNeedsAi(components: WageComponent[]) {
  const hasBase = components.some((component) => slugifyComponent(component.name).includes("basic"));
  const hasBalancing = components.some((component) => component.calculationType === "balancing");
  return components.length < 3 || !hasBase || !hasBalancing;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request);
    await params; // consume params

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

    let components: WageComponent[] | null = null;
    let parserSource: "deterministic" | "openrouter" | "gemini_fallback" = "deterministic";
    const deterministicComponents = sanitizeParsedComponents(
      parseSheetDeterministically(Array.isArray(matrix) ? matrix : buildFallbackMatrix(rows)),
    );

    components = deterministicComponents;

    if (hasOpenRouter() && inferNeedsAi(deterministicComponents)) {
      try {
        const aiResult = await parseWithOpenRouter(rows, deterministicComponents);
        components = sanitizeParsedComponents(aiResult.data.components);
        parserSource = "openrouter";
      } catch (error) {
        console.warn("OpenRouter wage parsing failed, using deterministic parser.", error);
      }
    }

    if ((!components || components.length === 0) && process.env.GEMINI_API_KEY) {
      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            generationConfig: { maxOutputTokens: 800, temperature: 0.1, responseMimeType: "application/json" },
            contents: [{ parts: [{ text: legacyGeminiPrompt(rows) }] }],
          }),
        },
      );

      if (geminiResponse.ok) {
        const raw = await geminiResponse.json();
        const text = raw.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
        const parsed = JSON.parse(extractLegacyJson(text)) as { components?: WageComponent[] };
        components = sanitizeParsedComponents(parsed.components ?? []);
        parserSource = "gemini_fallback";
      }
    }

    if (!components || components.length === 0) {
      components = fallbackParseComponents(rows as Record<string, unknown>[]);
      parserSource = "deterministic";
    }

    return NextResponse.json({
      components,
      usedFallbackParser: parserSource === "deterministic",
      parserSource,
      parserLabel: parserLabel(parserSource),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error parsing file";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
