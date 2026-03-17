import type { ComplianceSettings, WageComponent, PTSlab, TDSSlab } from "@/types/payroll";

/** Round to 2 decimal places */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Calculate EPF contributions.
 * Returns { employeeEPF, employerEPS, employerEPF, totalEmployerEPF }
 */
export function calculateEPF(
  epfApplicableWage: number,
  settings: ComplianceSettings["epf"]
): { employeeEPF: number; employerEPS: number; employerEPF: number; totalEmployerEPF: number } {
  const capped = Math.min(epfApplicableWage, settings.wageCeiling);
  const employeeEPF = round2(capped * settings.employeeRate);
  const eps = round2(capped * settings.employerEpsRate);
  const empEPF = round2(capped * settings.employerEpfRate);
  const totalEmployer = Math.min(round2(eps + empEPF), settings.maxEmployerContribution);
  return { employeeEPF, employerEPS: eps, employerEPF: empEPF, totalEmployerEPF: totalEmployer };
}

/**
 * Calculate ESIC contributions (only if grossWage <= ceiling).
 * Returns null if not applicable.
 */
export function calculateESIC(
  grossWage: number,
  settings: ComplianceSettings["esic"]
): { employeeESIC: number; employerESIC: number } | null {
  if (grossWage > settings.grossWageCeiling) return null;
  return {
    employeeESIC: round2(grossWage * settings.employeeRate),
    employerESIC: round2(grossWage * settings.employerRate),
  };
}

/** Calculate Professional Tax from slabs */
export function calculatePT(monthlyGross: number, slabs: PTSlab[]): number {
  const sorted = [...slabs].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
  for (const slab of sorted) {
    if (slab.upTo === null || monthlyGross <= slab.upTo) return slab.monthly;
  }
  return 0;
}

/** Calculate monthly TDS from projected annual gross */
export function calculateTDS(
  monthlyGross: number,
  settings: ComplianceSettings["tds"]
): number {
  const annual = monthlyGross * 12;
  const taxableAnnual = Math.max(0, annual - settings.standardDeduction);
  const sorted = [...settings.slabs].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
  let tax = 0;
  let prev = 0;
  for (const slab of sorted) {
    const ceiling = slab.upTo ?? Infinity;
    if (taxableAnnual <= prev) break;
    const taxable = Math.min(taxableAnnual, ceiling) - prev;
    tax += taxable * slab.rate;
    prev = ceiling;
  }
  return round2(tax / 12);
}

/**
 * Compute component amounts from a wage config given gross monthly CTC.
 * Returns a map of componentId → computed amount.
 */
export function applyWageComponents(
  grossCTC: number,
  components: WageComponent[]
): Record<string, number> {
  const result: Record<string, number> = {};
  const sorted = [...components]
    .filter((c) => c.type === "earning")
    .sort((a, b) => a.order - b.order);

  let basic = 0;
  let epfBase = 0;
  let allocated = 0;
  let balancingId: string | null = null;

  for (const comp of sorted) {
    if (comp.calculationType === "balancing") {
      balancingId = comp.id;
      continue;
    }
    let amount = 0;
    if (comp.calculationType === "fixed_amount") amount = comp.value ?? 0;
    else if (comp.calculationType === "pct_of_ctc") amount = round2(grossCTC * (comp.value ?? 0) / 100);
    else if (comp.calculationType === "pct_of_basic") amount = round2(basic * (comp.value ?? 0) / 100);
    else if (comp.calculationType === "pct_of_gross") amount = round2(grossCTC * (comp.value ?? 0) / 100);
    else if (comp.calculationType === "pct_of_epf_base") amount = round2(epfBase * (comp.value ?? 0) / 100);

    result[comp.id] = amount;
    allocated += amount;

    // Track basic for dependent calculations
    if (comp.name.toLowerCase().includes("basic")) basic = amount;
    if (comp.epfApplicable) epfBase += amount;
  }

  // Balancing component gets the remainder
  if (balancingId) {
    result[balancingId] = round2(Math.max(0, grossCTC - allocated));
  }

  return result;
}

/** LOP deduction: (gross / workingDays) * lopDays */
export function calculateLOP(grossMonthly: number, workingDays: number, lopDays: number): number {
  if (workingDays <= 0 || lopDays <= 0) return 0;
  return round2((grossMonthly / workingDays) * lopDays);
}
