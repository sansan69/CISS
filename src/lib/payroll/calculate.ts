import type {
  ComplianceSettings,
  PTSlab,
  TDSSlab,
  WageComponent,
  WageTemplateConstant,
  WageTemplateRule,
} from "@/types/payroll";
import { evaluateWageTemplate } from "./wage-template-evaluator";

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

export function derivePayrollTemplateFromWageConfig(
  components: WageComponent[],
): { grossMonthly: number; componentAmounts: Record<string, number> } | null {
  const earnings = [...components]
    .filter((component) => component.type === "earning")
    .sort((a, b) => a.order - b.order);

  if (earnings.length === 0) return null;

  const componentAmounts: Record<string, number> = {};
  const deferredBasic: WageComponent[] = [];
  const deferredEpfBase: WageComponent[] = [];
  const deferredGross: WageComponent[] = [];

  let basic = 0;
  let epfBase = 0;
  let knownTotal = 0;

  for (const component of earnings) {
    const value = component.value ?? 0;

    if (component.calculationType === "fixed_amount") {
      componentAmounts[component.id] = round2(value);
      knownTotal += round2(value);
      if (component.name.toLowerCase().includes("basic")) basic = round2(value);
      if (component.epfApplicable) epfBase = round2(epfBase + value);
      continue;
    }

    if (component.calculationType === "pct_of_basic") {
      deferredBasic.push(component);
      continue;
    }

    if (component.calculationType === "pct_of_epf_base") {
      deferredEpfBase.push(component);
      continue;
    }

    if (component.calculationType === "pct_of_ctc" || component.calculationType === "pct_of_gross") {
      deferredGross.push(component);
      continue;
    }
  }

  for (const component of deferredBasic) {
    const amount = round2(basic * ((component.value ?? 0) / 100));
    componentAmounts[component.id] = amount;
    knownTotal += amount;
    if (component.epfApplicable) epfBase = round2(epfBase + amount);
  }

  for (const component of deferredEpfBase) {
    const amount = round2(epfBase * ((component.value ?? 0) / 100));
    componentAmounts[component.id] = amount;
    knownTotal += amount;
  }

  const grossRate = deferredGross.reduce(
    (sum, component) => sum + ((component.value ?? 0) / 100),
    0,
  );

  const grossMonthly =
    knownTotal > 0 && grossRate > 0 && grossRate < 1
      ? round2(knownTotal / (1 - grossRate))
      : round2(knownTotal);

  for (const component of deferredGross) {
    componentAmounts[component.id] = round2(grossMonthly * ((component.value ?? 0) / 100));
  }

  const finalGross = round2(
    Object.values(componentAmounts).reduce((sum, amount) => sum + amount, 0),
  );

  if (finalGross <= 0) return null;

  return {
    grossMonthly: finalGross,
    componentAmounts,
  };
}

/** LOP deduction: (gross / workingDays) * lopDays */
export function calculateLOP(grossMonthly: number, workingDays: number, lopDays: number): number {
  if (workingDays <= 0 || lopDays <= 0) return 0;
  return round2((grossMonthly / workingDays) * lopDays);
}

export function prorateAmount(amount: number, workingDays: number, payableDays: number): number {
  if (workingDays <= 0) return round2(amount);
  return round2(amount * Math.max(0, Math.min(payableDays, workingDays)) / workingDays);
}

export function normalizeComponentName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

export function computeEpfApplicableWage(
  componentAmounts: Record<string, number>,
  components: WageComponent[],
): number {
  const byId = new Map(components.map((component) => [component.id, component]));
  return round2(
    Object.entries(componentAmounts).reduce((sum, [componentId, amount]) => {
      const component = byId.get(componentId);
      if (component?.epfApplicable) return sum + amount;
      const normalized = normalizeComponentName(component?.name || componentId);
      if (normalized.includes("basic") || normalized === "da" || normalized.includes("dearness")) {
        return sum + amount;
      }
      return sum;
    }, 0),
  );
}

export function summarizeNamedEarnings(componentAmounts: Record<string, number>, components: WageComponent[]) {
  const summary = {
    basic: 0,
    hra: 0,
    da: 0,
    conveyance: 0,
    specialAllowance: 0,
    otherAllowances: 0,
  };

  const byId = new Map(components.map((component) => [component.id, component]));

  for (const [componentId, amount] of Object.entries(componentAmounts)) {
    const component = byId.get(componentId);
    if (component && component.type !== "earning") continue;

    const normalized = normalizeComponentName(component?.name || componentId);
    if (normalized.includes("basic")) summary.basic += amount;
    else if (normalized.includes("hra") || normalized.includes("house_rent")) summary.hra += amount;
    else if (normalized === "da" || normalized.includes("dearness")) summary.da += amount;
    else if (normalized.includes("conveyance") || normalized.includes("travel")) summary.conveyance += amount;
    else if (normalized.includes("special")) summary.specialAllowance += amount;
    else summary.otherAllowances += amount;
  }

  return {
    basic: round2(summary.basic),
    hra: round2(summary.hra),
    da: round2(summary.da),
    conveyance: round2(summary.conveyance),
    specialAllowance: round2(summary.specialAllowance),
    otherAllowances: round2(summary.otherAllowances),
  };
}

export function applySavedWageTemplate(input: {
  rules: WageTemplateRule[];
  constants: WageTemplateConstant[];
  attendance: Record<string, number>;
  seededComponents?: Record<string, number>;
}) {
  return evaluateWageTemplate({
    rules: input.rules,
    constants: input.constants,
    attendance: input.attendance,
    seededComponents: input.seededComponents,
  });
}
