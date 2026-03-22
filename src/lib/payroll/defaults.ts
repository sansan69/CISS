import type { ComplianceSettings } from "@/types/payroll";

export const KERALA_COMPLIANCE_DEFAULTS: ComplianceSettings = {
  epf: {
    employeeRate: 0.12,
    employerEpsRate: 0.0833,
    employerEpfRate: 0.0367,
    wageCeiling: 15000,
    maxEmployerContribution: 1800,
  },
  esic: {
    employeeRate: 0.0075,
    employerRate: 0.0325,
    grossWageCeiling: 21000,
  },
  professionalTax: {
    state: "Kerala",
    slabs: [
      { upTo: 11999, monthly: 0 },
      { upTo: 17999, monthly: 120 },
      { upTo: 29999, monthly: 180 },
      { upTo: null, monthly: 200 },
    ],
  },
  tds: {
    regime: "new",
    standardDeduction: 75000,
    slabs: [
      { upTo: 300000, rate: 0 },
      { upTo: 700000, rate: 0.05 },
      { upTo: 1000000, rate: 0.1 },
      { upTo: 1200000, rate: 0.15 },
      { upTo: 1500000, rate: 0.2 },
      { upTo: null, rate: 0.3 },
    ],
  },
  bonus: {
    rate: 0.0833,
    minimumWageBase: 7000,
  },
  gratuity: {
    rate: 0.0481,
    minimumYearsForPayout: 5,
  },
  changeHistory: [],
};

export function cloneComplianceSettings(): ComplianceSettings {
  return JSON.parse(JSON.stringify(KERALA_COMPLIANCE_DEFAULTS)) as ComplianceSettings;
}
