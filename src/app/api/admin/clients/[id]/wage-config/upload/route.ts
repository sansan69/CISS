import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import type { WageComponentType, CalculationType } from "@/types/payroll";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(v: string) {
  return v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function parseNum(raw: string): number | null {
  const cleaned = raw.replace(/[,₹\s]/g, "").replace(/%$/, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function hasPctSuffix(raw: string) {
  return /\d\s*%/.test(raw);
}

function inferType(header: string): WageComponentType {
  const n = slugify(header);
  if (
    n.includes("epf") || n === "pf" || n.includes("esic") ||
    n.includes("professional_tax") || n === "pt" ||
    n.includes("tds") || n.includes("income_tax") ||
    n.includes("deduction") || n.includes("lop")
  ) return "deduction";
  if (n.includes("employer") || n.includes("er_")) return "employer_contribution";
  return "earning";
}

// Columns that are summaries / metadata — skip by default
function isSummaryColumn(header: string): boolean {
  const n = slugify(header);
  return (
    n === "total" || n === "gross" || n === "gross_salary" || n === "gross_earnings" ||
    n === "net" || n === "net_pay" || n === "net_salary" || n === "take_home" ||
    n === "sl" || n === "sl_no" || n === "sr" || n === "sr_no" ||
    n === "no" || n === "sno" || n === "s_no" || n === "#" ||
    n === "date" || n === "month" || n === "year" || n === "period" ||
    n === "name" || n === "employee" || n === "employee_name" || n === "employee_id" ||
    n === "designation" || n === "department"
  );
}

// ─── Column analysis ──────────────────────────────────────────────────────────

export interface ColumnAnalysis {
  header: string;
  colIndex: number;
  sampleValues: string[];          // up to 5 non-empty values from the sheet
  detectedType: WageComponentType;
  detectedCalcType: CalculationType;
  detectedValue: number | null;    // fixed ₹ amount
  detectedRate: number | null;     // percentage rate
  hint: string;                    // human-readable description
  isLikelySummary: boolean;        // columns to skip by default (Gross, Total, etc.)
}

function analyzeColumn(
  header: string,
  colIndex: number,
  colValues: string[],             // all data-row values for this column
  allCols: { header: string; nums: number[] }[], // parsed nums for every column
): ColumnAnalysis {
  const n = slugify(header);
  const type = inferType(header);
  const isLikelySummary = isSummaryColumn(header);

  const sampleValues = colValues.filter((v) => v.trim()).slice(0, 5);
  const rawNums = colValues
    .map((v) => ({ pct: hasPctSuffix(v), val: parseNum(v) }))
    .filter((x) => x.val !== null && x.val >= 0);

  const nums = rawNums.map((x) => x.val as number);
  const anyPctLabel = rawNums.some((x) => x.pct);

  // ── Known statutory components ────────────────────────────────────────────

  if (n.includes("epf") || n === "pf") {
    // EPF value cell might be 960 (amount) or "12%" (rate)
    if (anyPctLabel && nums.length > 0) {
      return { header, colIndex, sampleValues, detectedType: "deduction", detectedCalcType: "pct_of_epf_base", detectedValue: null, detectedRate: nums[0], hint: `${nums[0]}% of EPF base wage (Basic + DA)`, isLikelySummary: false };
    }
    return { header, colIndex, sampleValues, detectedType: "deduction", detectedCalcType: "pct_of_epf_base", detectedValue: nums[0] ?? null, detectedRate: 12, hint: "12% of EPF base wage (Basic + DA)", isLikelySummary: false };
  }

  if (n.includes("esic")) {
    return { header, colIndex, sampleValues, detectedType: "deduction", detectedCalcType: "pct_of_gross", detectedValue: nums[0] ?? null, detectedRate: 0.75, hint: "0.75% of gross salary (ESIC)", isLikelySummary: false };
  }

  if (n === "pt" || n.includes("professional_tax") || n === "p_tax") {
    return { header, colIndex, sampleValues, detectedType: "deduction", detectedCalcType: "kerala_slab", detectedValue: nums[0] ?? null, detectedRate: null, hint: "Kerala PT slab (₹0–₹200/month based on gross)", isLikelySummary: false };
  }

  if (n.includes("tds") || n === "income_tax") {
    return { header, colIndex, sampleValues, detectedType: "deduction", detectedCalcType: "tds_projected", detectedValue: nums[0] ?? null, detectedRate: null, hint: "Projected annual tax ÷ 12 months", isLikelySummary: false };
  }

  if (n.includes("special") || n.includes("balancing") || n.includes("spl_allowance")) {
    return { header, colIndex, sampleValues, detectedType: "earning", detectedCalcType: "balancing", detectedValue: null, detectedRate: null, hint: "Balancing component — auto-calculated as CTC minus all others", isLikelySummary: false };
  }

  // ── Cells explicitly labelled as % ───────────────────────────────────────

  if (anyPctLabel && nums.length > 0) {
    const rate = nums[0];
    if (n.includes("hra")) {
      return { header, colIndex, sampleValues, detectedType: "earning", detectedCalcType: "pct_of_basic", detectedValue: null, detectedRate: rate, hint: `${rate}% of Basic Salary`, isLikelySummary: false };
    }
    return { header, colIndex, sampleValues, detectedType: type, detectedCalcType: "pct_of_basic", detectedValue: null, detectedRate: rate, hint: `${rate}% rate (adjust formula if needed)`, isLikelySummary: false };
  }

  // ── Ratio detection against Basic column (multiple rows) ─────────────────

  const basicCol = allCols.find((c) => {
    const s = slugify(c.header);
    return s === "basic" || s === "basic_salary" || s === "basic_pay";
  });

  if (basicCol && basicCol.nums.length >= 2 && nums.length >= 2) {
    const ratios = nums
      .map((v, i) => (basicCol.nums[i] ?? 0) > 0 ? v / basicCol.nums[i] : null)
      .filter((r): r is number => r !== null && r > 0 && r < 3);

    if (ratios.length >= 2) {
      const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      const allClose = ratios.every((r) => Math.abs(r - avg) < 0.02);
      if (allClose) {
        const pct = Math.round(avg * 100 * 10) / 10; // 1 decimal
        return { header, colIndex, sampleValues, detectedType: type, detectedCalcType: "pct_of_basic", detectedValue: null, detectedRate: pct, hint: `${pct}% of Basic Salary (detected from ${nums.length} rows)`, isLikelySummary: false };
      }
    }
  }

  // ── HRA with single row ───────────────────────────────────────────────────

  if (n.includes("hra") && basicCol && basicCol.nums.length > 0 && nums.length > 0) {
    const ratio = nums[0] / basicCol.nums[0];
    if (ratio > 0.1 && ratio < 1.2) {
      const pct = Math.round(ratio * 100);
      return { header, colIndex, sampleValues, detectedType: "earning", detectedCalcType: "pct_of_basic", detectedValue: nums[0], detectedRate: pct, hint: `~${pct}% of Basic Salary`, isLikelySummary: false };
    }
  }

  // ── Default: fixed amount ─────────────────────────────────────────────────

  const fixedValue = nums.length > 0 ? nums[0] : null;
  const hintStr = fixedValue !== null
    ? `Fixed amount — ₹${fixedValue.toLocaleString("en-IN")} from sheet`
    : "No value detected — set manually";

  return {
    header, colIndex, sampleValues,
    detectedType: type,
    detectedCalcType: "fixed_amount",
    detectedValue: fixedValue,
    detectedRate: null,
    hint: hintStr,
    isLikelySummary,
  };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin(request);
    await params;

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const sheetIndexParam = formData.get("sheetIndex");
    const sheetIndex = sheetIndexParam !== null ? parseInt(String(sheetIndexParam), 10) : 0;

    const buffer = Buffer.from(await file.arrayBuffer());
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buffer, { type: "buffer" });

    const sheetNames: string[] = wb.SheetNames;
    if (!sheetNames.length) {
      return NextResponse.json({ error: "No sheets found in file." }, { status: 400 });
    }

    const resolvedIndex = Math.min(sheetIndex, sheetNames.length - 1);
    const selectedSheet = sheetNames[resolvedIndex];
    const ws = wb.Sheets[selectedSheet];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" }) as unknown[][];

    if (!matrix.length || !matrix.some((row) => row.some((cell) => String(cell ?? "").trim()))) {
      return NextResponse.json({ error: "Selected sheet appears to be empty." }, { status: 400 });
    }

    // Find header row: the row with the most non-empty cells within the first 10 rows.
    // This handles wagesheets that have title rows above the actual column headers
    // (e.g. "CISS SERVICES LTD" on row 0, month title on row 1, real headers on row 2).
    let headerRowIndex = 0;
    let maxNonEmpty = 0;
    for (let i = 0; i < Math.min(10, matrix.length); i++) {
      const nonEmpty = matrix[i].filter((cell) => String(cell ?? "").trim()).length;
      if (nonEmpty > maxNonEmpty) {
        maxNonEmpty = nonEmpty;
        headerRowIndex = i;
      }
    }

    const headers = (matrix[headerRowIndex] ?? []).map((v, i) => {
      const s = String(v ?? "").trim();
      return s || `Column ${i + 1}`;
    });

    // Data rows (up to 200); exclude summary/total rows
    const rows: string[][] = matrix
      .slice(headerRowIndex + 1, headerRowIndex + 201)
      .filter((row) => {
        if (!row.some((cell) => String(cell ?? "").trim())) return false;
        // Exclude TOTAL / GRAND TOTAL rows
        const firstNonEmpty = row.find((cell) => String(cell ?? "").trim());
        if (firstNonEmpty) {
          const s = String(firstNonEmpty).trim().toLowerCase();
          if (s === "total" || s === "grand total" || s === "subtotal") return false;
        }
        return true;
      })
      .map((row) => headers.map((_, i) => String(row[i] ?? "").trim()));

    // Build per-column value arrays for ratio detection
    const colNums = headers.map((h, ci) => ({
      header: h,
      nums: rows
        .map((row) => parseNum(row[ci] ?? ""))
        .filter((n): n is number => n !== null && n > 0),
    }));

    // Analyze each column
    const columnAnalysis: ColumnAnalysis[] = headers.map((h, ci) => {
      const colValues = rows.map((row) => row[ci] ?? "");
      return analyzeColumn(h, ci, colValues, colNums);
    });

    return NextResponse.json({
      sheetNames,
      selectedSheet,
      sheetIndex: resolvedIndex,
      headers,
      rows,
      totalRows: rows.length,
      columnAnalysis,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error reading file";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
