import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";

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

    const prompt = `You are a payroll configuration expert. Analyze the following salary/wage structure data extracted from an Excel file and extract wage components as a JSON array.

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
- confidence: number between 0 and 1 indicating your confidence

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

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );

    const raw = await geminiResponse.json();
    const text = raw.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    const jsonMatch = text.match(/```json\n?([\s\S]*?)```/) || text.match(/(\[[\s\S]*\])/);
    const components = JSON.parse(jsonMatch?.[1] ?? text);

    return NextResponse.json({ components });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error parsing file";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
