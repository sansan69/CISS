export type WageSheetFamily =
  | "flat_register"
  | "title_row_register"
  | "formula_heavy_register";

export type TemplateFieldCategory =
  | "meta"
  | "attendance"
  | "earning"
  | "deduction"
  | "employer_contribution"
  | "summary";

export type FormulaSource = "header" | "cell";

export interface TemplateDetectedConstant {
  key: string;
  value: number;
  source: FormulaSource;
}

export interface TemplateFieldAnalysis {
  columnIndex: number;
  originalLabel: string;
  normalizedLabel: string;
  standardName: string;
  category: TemplateFieldCategory;
  sampleValues: string[];
  sampleCellFormulas: string[];
  formulaSources: FormulaSource[];
  headerFormulaHint: string | null;
  ruleHint: string;
  attendanceBound: boolean;
  likelyIgnored: boolean;
  detectedConstants: TemplateDetectedConstant[];
}

function slugify(v: string) {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function isNumericLike(value: string) {
  return /^-?[\d,.]+$/.test(value.trim());
}

function rowNonEmptyCount(row: unknown[]) {
  return row.filter((cell) => String(cell ?? "").trim()).length;
}

function rowTextishScore(row: unknown[]) {
  return row.reduce<number>((score, cell) => {
    const value = String(cell ?? "").trim();
    if (!value) return score;
    if (value.startsWith("=")) return score + 1;
    if (!isNumericLike(value)) return score + 2;
    return score + 0.25;
  }, 0);
}

function isPayrollishHeader(label: string) {
  const normalized = slugify(label);
  return [
    "name",
    "guard",
    "basic",
    "da",
    "gross",
    "pf",
    "esi",
    "duties",
    "attendance",
    "allowance",
    "bonus",
    "leave",
    "wages",
    "salary",
    "hra",
    "uniform",
    "branch",
    "district",
  ].some((part) => normalized.includes(part));
}

export function detectHeaderRow(rows: unknown[][]) {
  let bestIndex = 0;
  let bestScore = -1;

  for (let index = 0; index < Math.min(rows.length, 12); index += 1) {
    const row = rows[index] ?? [];
    const nonEmpty = rowNonEmptyCount(row);
    if (nonEmpty < 4) continue;

    const payrollBonus = row.some((cell) => isPayrollishHeader(String(cell ?? ""))) ? 8 : 0;
    const score = rowTextishScore(row) + nonEmpty + payrollBonus;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

export function inferSheetFamily(rows: unknown[][], headerRowIndex: number): WageSheetFamily {
  const hasTitleRows = headerRowIndex > 0;
  const header = (rows[headerRowIndex] ?? []).map((cell) => String(cell ?? "").trim());
  const headerFormulaLikeCount = header.filter((cell) => /[%()]|\bof\b|\bcap/i.test(cell)).length;
  const advancedHeaderCount = header.filter((cell) =>
    /(vda|hra|epf|edli|admin charges|salary payable|additional duty|field duty allowance)/i.test(cell),
  ).length;
  const formulaCount = rows
    .slice(headerRowIndex + 1, headerRowIndex + 8)
    .flat()
    .filter((cell) => String(cell ?? "").trim().startsWith("=")).length;

  if (headerFormulaLikeCount >= 3) return "formula_heavy_register";
  if (hasTitleRows) return "title_row_register";
  if (advancedHeaderCount >= 2 && formulaCount >= 8) return "formula_heavy_register";
  return "flat_register";
}

function inferStandardName(label: string) {
  const normalized = slugify(label);
  const explicitMap: Array<[RegExp, string]> = [
    [/^sl(_?no)?$/, "serial_no"],
    [/(name_of_the_guard|^name$|employee_name)/, "employee_name"],
    [/(employee_id|emp_no|id_no|employee_id)/, "employee_code"],
    [/(no_of_duties|^duties$|total_duties)/, "payable_duties"],
    [/(^wf$|w_0|w\/0|wo)/, "weekly_off"],
    [/^ed$/, "extra_duty_days"],
    [/^hd$|half_day/, "half_day"],
    [/(basic_vda|basic_da|basic_and_da|basic_da_combined|basic_da$|basic_da_)/, "basic_da_combined"],
    [/^basic$/, "basic"],
    [/(^da$|dearness|vda)/, "da"],
    [/hra|house_rent/, "hra"],
    [/(wash_allow|w_all|washing_allowance)/, "wash_allowance"],
    [/(uniform_outfit|uniform)/, "uniform_allowance"],
    [/bonus/, "bonus"],
    [/field_duty_allowance|duty_allowance/, "duty_allowance"],
    [/reliver|reliever/, "reliever_charges"],
    [/extra_4_hrs|extra_4_hours|extra_dutes/, "extra_duty_amount"],
    [/(gross|salary_payable)/, "gross"],
    [/(pf|epf)/, "pf_employee"],
    [/(esi|esic)/, "esi_employee"],
    [/tds/, "tds"],
    [/adv|advance/, "advance"],
    [/(tot_ded|total_ded)/, "total_deduction"],
    [/(net_wages|net_pay|net_salary)/, "net_wages"],
    [/edli/, "edli"],
    [/admin_charges/, "admin_charges"],
  ];

  for (const [pattern, mapped] of explicitMap) {
    if (pattern.test(normalized)) return mapped;
  }

  return normalized || "unnamed_field";
}

function inferCategory(label: string): TemplateFieldCategory {
  const normalized = slugify(label);

  if (
    /(sl_no|serial|district|branch|zone|rank|uan|esic_no|emp_no|employee_id|name|desg|designation|field_officer|supervisor|day_night)/.test(
      normalized,
    )
  ) {
    return "meta";
  }

  if (
    /(duties|weekly_off|w_0|w\/0|^wf$|^wd$|^ed$|^hd$|total$|no_of_duties|additional_duties)/.test(
      normalized,
    )
  ) {
    return "attendance";
  }

  if (
    /(gross|net|salary_payable|tot_ded|total_deduction|total_employee_contribution|total_employer_contribution)/.test(
      normalized,
    )
  ) {
    return "summary";
  }

  if (/(edli|admin_charges|employer)/.test(normalized)) {
    return "employer_contribution";
  }

  if (/(pf|epf|esi|esic|tds|pt|professional_tax|lwf|adv|advance)/.test(normalized)) {
    return "deduction";
  }

  return "earning";
}

function extractNumbers(text: string) {
  const matches = text.match(/\d+(?:,\d{3})*(?:\.\d+)?/g) ?? [];
  return matches
    .map((match) => Number(match.replace(/,/g, "")))
    .filter((value) => Number.isFinite(value));
}

function buildConstants(label: string, formulas: string[]) {
  const constants: TemplateDetectedConstant[] = [];
  const seen = new Set<string>();
  const headerNumbers = extractNumbers(label);
  const normalized = inferStandardName(label);

  headerNumbers.forEach((value, index) => {
    const key = `${normalized}_header_${index + 1}`;
    const signature = `header:${value}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    constants.push({ key, value, source: "header" });
  });

  formulas.forEach((formula, formulaIndex) => {
    extractNumbers(formula).forEach((value, valueIndex) => {
      const signature = `cell:${value}`;
      if (seen.has(signature)) return;
      seen.add(signature);
      constants.push({
        key: `${normalized}_cell_${formulaIndex + 1}_${valueIndex + 1}`,
        value,
        source: "cell",
      });
    });
  });

  return constants;
}

function buildHeaderFormulaHint(label: string) {
  if (/[()%/+*-]/.test(label) || /\bof\b/i.test(label) || /\bcap/i.test(label)) {
    return label.trim();
  }

  return null;
}

function buildRuleHint(
  label: string,
  headerFormulaHint: string | null,
  sampleCellFormulas: string[],
  category: TemplateFieldCategory,
) {
  if (headerFormulaHint && sampleCellFormulas.length > 0) {
    return `Header and cell formulas both detected for ${label}`;
  }
  if (headerFormulaHint) {
    return `Header formula detected for ${label}`;
  }
  if (sampleCellFormulas.length > 0) {
    return `Cell formula detected for ${label}`;
  }
  if (category === "attendance") return `${label} should bind from attendance by default`;
  if (category === "summary") return `${label} should usually be derived, not treated as a primary component`;
  return `${label} detected from uploaded sheet values`;
}

export function analyzeTemplateFields(rows: unknown[][], headerRowIndex: number): TemplateFieldAnalysis[] {
  const headers = (rows[headerRowIndex] ?? []).map((cell, index) => {
    const value = String(cell ?? "").trim();
    return value || `Column ${index + 1}`;
  });

  const dataRows = rows
    .slice(headerRowIndex + 1)
    .filter((row) => row.some((cell) => String(cell ?? "").trim()))
    .filter((row) => {
      const first = String(row.find((cell) => String(cell ?? "").trim()) ?? "").trim().toLowerCase();
      return first !== "total" && first !== "grand total" && first !== "subtotal";
    });

  return headers.map((header, columnIndex) => {
    const columnValues = dataRows
      .map((row) => String(row[columnIndex] ?? "").trim())
      .filter(Boolean);

    const sampleValues = columnValues.slice(0, 5);
    const sampleCellFormulas = columnValues.filter((value) => value.startsWith("=")).slice(0, 5);
    const headerFormulaHint = buildHeaderFormulaHint(header);
    const formulaSources: FormulaSource[] = [];
    if (headerFormulaHint) formulaSources.push("header");
    if (sampleCellFormulas.length > 0) formulaSources.push("cell");

    const category = inferCategory(header);
    const normalizedLabel = slugify(header);
    const standardName = inferStandardName(header);
    const attendanceBound = category === "attendance";
    const likelyIgnored = category === "summary" || category === "meta";
    const detectedConstants = buildConstants(header, sampleCellFormulas);

    return {
      columnIndex,
      originalLabel: header,
      normalizedLabel,
      standardName,
      category,
      sampleValues,
      sampleCellFormulas,
      formulaSources,
      headerFormulaHint,
      ruleHint: buildRuleHint(header, headerFormulaHint, sampleCellFormulas, category),
      attendanceBound,
      likelyIgnored,
      detectedConstants,
    };
  });
}
