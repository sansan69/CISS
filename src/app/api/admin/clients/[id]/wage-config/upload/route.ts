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
  if (normalized.includes("special")) return "balancing";
  return "fixed_amount";
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

    components.push({
      id: normalized,
      name: name.trim(),
      type: inferType(name),
      calculationType: inferCalcType(name),
      value: normalized.includes("special") ? null : numeric ?? 0,
      isStatutory:
        normalized.includes("epf") ||
        normalized.includes("esic") ||
        normalized.includes("professional_tax") ||
        normalized.includes("tds"),
      statutoryType:
        normalized.includes("epf")
          ? "epf"
          : normalized.includes("esic")
            ? "esic"
            : normalized.includes("professional_tax")
              ? "pt"
              : normalized.includes("tds")
                ? "tds"
                : null,
      isTaxable: !normalized.includes("epf") && !normalized.includes("esic") && !normalized.includes("professional_tax"),
      epfApplicable: normalized.includes("basic") || normalized === "da" || normalized.includes("dearness"),
      order: components.length + 1,
    });
  }

  if (!components.some((component) => component.calculationType === "balancing")) {
    components.push({
      id: "special_allowance",
      name: "Special Allowance",
      type: "earning",
      calculationType: "balancing",
      value: null,
      isStatutory: false,
      statutoryType: null,
      isTaxable: true,
      epfApplicable: false,
      order: components.length + 1,
    });
  }

  return components;
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
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

    const prompt = `You are a payroll configuration expert. Extract a JSON array of wage components from the following spreadsheet rows.

Excel data:
${JSON.stringify(rows, null, 2)}

Return ONLY a valid JSON array of wage components. Each component must have these exact fields:
- id: a short unique slug (e.g. "basic", "hra", "epf_employee")
- name: human-readable name (e.g. "Basic Salary", "HRA", "EPF Employee")
- type: one of "earning" | "deduction" | "employer_contribution"
- calculationType: one of "fixed_amount" | "pct_of_basic" | "pct_of_ctc" | "pct_of_gross" | "pct_of_epf_base" | "balancing"
- value: number (percentage without % sign, or fixed amount) or null if balancing
- isStatutory: boolean (true for EPF, ESIC, PT, TDS)
- statutoryType: one of "epf" | "esic" | "pt" | "tds" | null
- isTaxable: boolean (false for HRA up to limit, conveyance, etc.)
- epfApplicable: boolean (true for basic, DA typically)
- order: integer starting from 1

Common Kerala patterns:
- Basic: 50% of CTC, epfApplicable: true
- HRA: 20% of Basic
- DA: variable
- Conveyance: fixed amount
- Special Allowance: balancing component
- EPF Employee: 12% of EPF base, deduction, statutory
- ESIC Employee: 0.75% of gross, deduction, statutory (if applicable)
- Professional Tax: Kerala slab, deduction, statutory

Return only the JSON array, no other text.`;

    let components: WageComponent[] | null = null;
    let usedFallbackParser = false;

    if (process.env.GEMINI_API_KEY) {
      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            generationConfig: { maxOutputTokens: 600, temperature: 0.1, responseMimeType: "application/json" },
            contents: [{ parts: [{ text: prompt }] }],
          }),
        },
      );

      if (geminiResponse.ok) {
        const raw = await geminiResponse.json();
        const text = raw.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
        const jsonMatch = text.match(/```json\n?([\s\S]*?)```/) || text.match(/(\[[\s\S]*\])/);
        components = JSON.parse(jsonMatch?.[1] ?? text) as WageComponent[];
      }
    }

    if (!components || components.length === 0) {
      components = fallbackParseComponents(rows as Record<string, unknown>[]);
      usedFallbackParser = true;
    }

    return NextResponse.json({ components, usedFallbackParser });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error parsing file";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
