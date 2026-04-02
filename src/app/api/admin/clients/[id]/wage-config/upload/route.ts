import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { hasOpenRouter, requestOpenRouterJson } from "@/lib/server/openrouter";
import type { WageComponent, WageComponentType, CalculationType, StatutoryType } from "@/types/payroll";

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function parseNumber(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input !== "string") return null;
  const cleaned = input.replace(/[,%₹\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function inferType(name: string): WageComponentType {
  const n = slugify(name);
  if (n.includes("epf") || n.includes("esic") || n.includes("professional_tax") || n.includes("pt") || n.includes("tds") || n.includes("deduction") || n.includes("lop")) return "deduction";
  if (n.includes("employer")) return "employer_contribution";
  return "earning";
}

function inferCalcType(name: string): CalculationType {
  const n = slugify(name);
  if (n.includes("epf")) return "pct_of_epf_base";
  if (n.includes("esic")) return "pct_of_gross";
  if (n === "pt" || n.includes("professional_tax")) return "kerala_slab";
  if (n.includes("tds") || n.includes("income_tax")) return "tds_projected";
  if (n.includes("hra")) return "pct_of_basic";
  if (n.includes("special") || n.includes("balancing")) return "balancing";
  if (n.includes("percentage") || n.includes("percent")) return "pct_of_ctc";
  return "fixed_amount";
}

function inferStatutoryType(name: string): StatutoryType {
  const n = slugify(name);
  if (n.includes("epf")) return "epf";
  if (n.includes("esic")) return "esic";
  if (n === "pt" || n.includes("professional_tax")) return "pt";
  if (n.includes("tds") || n.includes("income_tax")) return "tds";
  return null;
}

function makeComponent(
  name: string,
  value: number | null,
  order: number,
  overrides: Partial<WageComponent> = {},
): WageComponent {
  const id = slugify(name);
  const statutory = overrides.statutoryType !== undefined ? overrides.statutoryType : inferStatutoryType(name);
  const calcType: CalculationType =
    overrides.calculationType ??
    (statutory === "pt"  ? "kerala_slab" :
     statutory === "tds" ? "tds_projected" :
     slugify(name).includes("special") && (value === null || value === 0) ? "balancing" :
     inferCalcType(name));

  return {
    id,
    name: name.trim(),
    type: inferType(name),
    calculationType: calcType,
    value: (calcType === "balancing" || calcType === "kerala_slab" || calcType === "tds_projected") ? null : (value ?? 0),
    isStatutory: statutory !== null,
    statutoryType: statutory,
    isTaxable: statutory === null,
    epfApplicable: ["basic", "da", "dearness"].some((kw) => slugify(name).includes(kw)),
    order,
    ...overrides,
  };
}

function ensureBalancing(components: WageComponent[]) {
  if (!components.some((c) => c.calculationType === "balancing")) {
    components.push(
      makeComponent("Special Allowance", null, components.length + 1, {
        calculationType: "balancing",
        value: null,
      }),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic fallback parser (rule-based, no AI)
// ─────────────────────────────────────────────────────────────────────────────

function isLikelyName(v: unknown): v is string {
  return typeof v === "string" && /[a-zA-Z]/.test(v) && v.trim().length > 1;
}

function parseColumnMajor(matrix: unknown[][]): WageComponent[] {
  const headers = (matrix[0] ?? []).map((v) => String(v).trim().toLowerCase());
  const nameIdx = headers.findIndex((h) =>
    ["component", "component name", "name", "earnings / deductions", "salary head", "particulars"].includes(h),
  );
  const valIdx = headers.findIndex((h) =>
    ["amount", "value", "monthly rate", "rate", "fixed", "percentage", "%"].includes(h),
  );
  if (nameIdx < 0) return [];
  const out: WageComponent[] = [];
  for (const row of matrix.slice(1)) {
    const name = String(row[nameIdx] ?? "").trim();
    if (!name) continue;
    const id = slugify(name);
    if (!id || out.some((c) => c.id === id)) continue;
    out.push(makeComponent(name, valIdx >= 0 ? parseNumber(row[valIdx]) : null, out.length + 1));
  }
  return out;
}

function parseTabularRows(matrix: unknown[][]): WageComponent[] {
  const out: WageComponent[] = [];
  for (const row of matrix) {
    const name = (row.filter(isLikelyName) as string[])[0]?.trim();
    if (!name) continue;
    const id = slugify(name);
    if (!id || out.some((c) => c.id === id)) continue;
    const value = row.map(parseNumber).find((v) => v !== null) ?? null;
    out.push(makeComponent(name, value, out.length + 1));
  }
  return out;
}

function deterministicParse(matrix: unknown[][]): WageComponent[] {
  const colMajor = parseColumnMajor(matrix);
  const tabular  = parseTabularRows(matrix);
  const base     = colMajor.length >= tabular.length ? colMajor : tabular;
  ensureBalancing(base);
  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI parser — Gemini via OpenRouter (primary) or direct Gemini API (secondary)
// ─────────────────────────────────────────────────────────────────────────────

/** Compact sheet text sent to the AI — cap at 80 rows to stay within token limits */
function sheetToText(matrix: unknown[][]): string {
  return matrix
    .slice(0, 80)
    .map((row) => row.map((cell) => String(cell ?? "").trim()).join(" | "))
    .join("\n");
}

const AI_SYSTEM_PROMPT = `You are a payroll data extraction expert for Indian security guard companies (CISS India).
You receive raw rows from an Excel wage structure sheet uploaded by an HR admin.
Your job: identify each wage component and return a JSON array.

Indian payroll context:
- Typical components: Basic Salary, HRA (House Rent Allowance), DA (Dearness Allowance),
  Special Allowance, Conveyance, Medical Allowance, EPF (Employee PF 12%), ESIC (0.75%),
  Professional Tax (PT/Kerala slab ₹0–₹200/month), TDS (Income Tax),
  Uniform Allowance, Night Shift Differential, NHD Wages, LOP Deduction, Bonus, Gratuity.
- EPF = 12% of (Basic+DA, capped ₹15,000). Employer also contributes 12%.
- ESIC = 0.75% of gross if gross ≤ ₹21,000.
- Professional Tax = Kerala slab — use calculationType "kerala_slab".
- TDS = projected annual tax ÷ 12 — use calculationType "tds_projected".
- Special Allowance is always the "balancing" component (CTC minus all others).
- Malayalam column headers may appear — translate them.

Classification rules:
1. Skip totals, blank rows, headers, footnotes, and grand total rows.
2. type: "earning" | "deduction" | "employer_contribution"
   - deduction: EPF (employee), ESIC (employee), PT, TDS, LOP
   - employer_contribution: EPF employer share, ESIC employer share, Gratuity provision
   - earning: everything else
3. calculationType: "fixed_amount" | "pct_of_basic" | "pct_of_ctc" | "pct_of_gross" | "pct_of_epf_base" | "balancing" | "kerala_slab" | "tds_projected"
4. value: numeric ₹ amount or % rate as a plain number (e.g. 12 for 12%). null for balancing/kerala_slab/tds_projected.
5. isStatutory: true only for EPF, ESIC, PT, TDS.
6. epfApplicable: true only for Basic and DA.
7. confidence 0.0–1.0:
   - 1.0: obvious statutory (EPF, ESIC, PT, TDS)
   - 0.9: clear name + numeric value
   - 0.7: reasonable inference
   - <0.7: ambiguous — will be flagged amber for admin review
8. If no "balancing" component exists, add Special Allowance with value null and confidence 0.85.`;

interface AiRawComponent {
  name: string;
  type: string;
  calculationType: string;
  value: number | null;
  isStatutory: boolean;
  statutoryType: string | null;
  isTaxable: boolean;
  epfApplicable: boolean;
  confidence: number;
}

const AI_JSON_SCHEMA = {
  type: "object",
  properties: {
    components: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name:             { type: "string" },
          type:             { type: "string", enum: ["earning", "deduction", "employer_contribution"] },
          calculationType:  { type: "string", enum: ["fixed_amount","pct_of_basic","pct_of_ctc","pct_of_gross","pct_of_epf_base","balancing","kerala_slab","tds_projected"] },
          value:            { anyOf: [{ type: "number" }, { type: "null" }] },
          isStatutory:      { type: "boolean" },
          statutoryType:    { anyOf: [{ type: "string", enum: ["epf","esic","pt","tds"] }, { type: "null" }] },
          isTaxable:        { type: "boolean" },
          epfApplicable:    { type: "boolean" },
          confidence:       { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["name","type","calculationType","value","isStatutory","statutoryType","isTaxable","epfApplicable","confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["components"],
  additionalProperties: false,
} as const;

async function parseWithOpenRouter(sheetText: string): Promise<AiRawComponent[]> {
  const { data } = await requestOpenRouterJson<{ components: AiRawComponent[] }>({
    prompt: `Wage sheet rows (columns separated by " | "):\n\n${sheetText}\n\nExtract all wage components.`,
    schema: AI_JSON_SCHEMA as unknown as Record<string, unknown>,
    systemPrompt: AI_SYSTEM_PROMPT,
    maxTokens: 2400,
    temperature: 0.05,
  });
  return Array.isArray(data.components) ? data.components : [];
}

function extractJsonFromText(text: string): string {
  const fenced = text.match(/```json\s*([\s\S]+?)```/i);
  if (fenced?.[1]) return fenced[1];
  const arr = text.match(/\[[\s\S]+\]/);
  if (arr?.[0]) return arr[0];
  const obj = text.match(/\{[\s\S]+\}/);
  return obj?.[0] ?? text;
}

async function parseWithGeminiDirect(sheetText: string): Promise<AiRawComponent[]> {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");

  const models = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-flash-8b"];
  let lastError = "Unknown error";

  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: AI_SYSTEM_PROMPT }] },
            contents: [
              {
                role: "user",
                parts: [{
                  text: `Wage sheet rows (columns separated by " | "):\n\n${sheetText}\n\nReturn a JSON array of wage component objects. Each must have: name, type, calculationType, value, isStatutory, statutoryType, isTaxable, epfApplicable, confidence.`,
                }],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.05,
              maxOutputTokens: 2400,
            },
          }),
        },
      );

      const raw = await res.json().catch(() => null);

      if (!res.ok) {
        lastError = raw?.error?.message ?? `HTTP ${res.status}`;
        if (res.status === 429 || (lastError.includes("RESOURCE_EXHAUSTED"))) continue;
        break;
      }

      const text = (raw?.candidates?.[0]?.content?.parts ?? [])
        .map((p: { text?: string }) => p.text ?? "")
        .join("");

      const parsed = JSON.parse(extractJsonFromText(text));
      const arr = Array.isArray(parsed) ? parsed : (parsed.components ?? []);
      return arr as AiRawComponent[];
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  throw new Error(`Gemini parse failed: ${lastError}`);
}

async function parseWithAI(sheetText: string): Promise<AiRawComponent[] | null> {
  try {
    if (hasOpenRouter()) {
      return await parseWithOpenRouter(sheetText);
    }
    return await parseWithGeminiDirect(sheetText);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Convert AI raw output → WageComponent[]
// ─────────────────────────────────────────────────────────────────────────────

function aiToComponents(items: AiRawComponent[]): WageComponent[] {
  const out: WageComponent[] = [];
  for (const item of items) {
    if (!item.name?.trim()) continue;
    const id = slugify(item.name);
    if (!id || out.some((c) => c.id === id)) continue;

    const calcType: CalculationType = [
      "fixed_amount","pct_of_basic","pct_of_ctc","pct_of_gross",
      "pct_of_epf_base","balancing","kerala_slab","tds_projected",
    ].includes(item.calculationType) ? (item.calculationType as CalculationType) : inferCalcType(item.name);

    const compType: WageComponentType = ["earning","deduction","employer_contribution"]
      .includes(item.type) ? (item.type as WageComponentType) : inferType(item.name);

    const statutory: StatutoryType = ["epf","esic","pt","tds"].includes(item.statutoryType ?? "")
      ? (item.statutoryType as StatutoryType)
      : inferStatutoryType(item.name);

    out.push({
      id,
      name: item.name.trim(),
      type: compType,
      calculationType: calcType,
      value: (calcType === "balancing" || calcType === "kerala_slab" || calcType === "tds_projected")
        ? null
        : (item.value ?? 0),
      isStatutory: item.isStatutory ?? (statutory !== null),
      statutoryType: statutory,
      isTaxable: item.isTaxable ?? (statutory === null),
      epfApplicable: item.epfApplicable ?? false,
      order: out.length + 1,
      confidence: Math.min(1, Math.max(0, item.confidence ?? 0.7)),
      aiDetected: true,
    });
  }
  ensureBalancing(out);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge with existing saved config — preserve admin edits
// ─────────────────────────────────────────────────────────────────────────────

function mergeWithExisting(parsed: WageComponent[], existing: WageComponent[]): WageComponent[] {
  if (!existing.length) return parsed;
  const byId   = new Map(existing.map((c) => [c.id, c]));
  const bySlug = new Map(existing.map((c) => [slugify(c.name), c]));
  const merged: WageComponent[] = [];

  for (const p of parsed) {
    const match = byId.get(p.id) ?? bySlug.get(slugify(p.name));
    if (match) {
      // Keep admin-confirmed type/calcType; only refresh value from new sheet
      merged.push({
        ...match,
        value: (match.calculationType === "balancing" || match.calculationType === "kerala_slab" || match.calculationType === "tds_projected")
          ? null
          : (p.value ?? match.value),
        confidence: p.confidence,
        aiDetected: p.aiDetected,
      });
    } else {
      merged.push({ ...p, order: merged.length + 1 });
    }
  }

  // Preserve existing components absent from the new sheet
  for (const ex of existing) {
    if (!merged.some((c) => c.id === ex.id)) {
      merged.push({ ...ex, order: merged.length + 1 });
    }
  }

  return merged
    .sort((a, b) => a.order - b.order)
    .map((c, i) => ({ ...c, order: i + 1 }));
}

function sanitize(components: WageComponent[]): WageComponent[] {
  const seen = new Set<string>();
  return components.filter((c) => {
    const id = c.id || slugify(c.name ?? "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin(request);
    const { id: clientId } = await params;

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    // Parse Excel → matrix
    const buffer = Buffer.from(await file.arrayBuffer());
    const XLSX   = await import("xlsx");
    const wb     = XLSX.read(buffer, { type: "buffer" });
    const ws     = wb.Sheets[wb.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" }) as unknown[][];

    // Load existing config (for merge / template reuse)
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const snap = await adminDb.collection("clientWageConfig").doc(clientId).get();
    const existing: WageComponent[] = Array.isArray(snap.data()?.components)
      ? sanitize(snap.data()!.components as WageComponent[])
      : [];

    // Primary: AI parse; fallback: deterministic rule-based
    const sheetText = sheetToText(matrix);
    const aiResults = await parseWithAI(sheetText);
    const usedAI    = aiResults !== null && aiResults.length > 0;

    let components: WageComponent[];
    if (usedAI) {
      const aiComponents = aiToComponents(aiResults!);
      components = existing.length ? mergeWithExisting(aiComponents, existing) : aiComponents;
    } else {
      const det = deterministicParse(matrix);
      components = existing.length ? mergeWithExisting(det, existing) : det;
    }

    components = sanitize(components);

    const lowConfidenceCount = components.filter(
      (c) => c.aiDetected && (c.confidence ?? 1) < 0.7,
    ).length;

    return NextResponse.json({
      components,
      parserSource:   usedAI ? "ai" : "deterministic",
      parserLabel:    usedAI ? "Gemini AI" : "built-in parser",
      aiUsed:         usedAI,
      lowConfidenceCount,
      templateMode:   existing.length > 0 ? "client_template" : "new",
      templateLocked: existing.length > 0,
      lastImportSummary: {
        parserSource:     usedAI ? "ai" : "deterministic",
        parserLabel:      usedAI ? "Gemini AI" : "built-in parser",
        parsedAt:         new Date().toISOString(),
        parsedComponents: components.length,
        aiUsed: usedAI,
        lowConfidenceCount,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error parsing file";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
