import type { Timestamp } from "firebase/firestore";

export type WageComponentType = "earning" | "deduction" | "employer_contribution";
export type CalculationType =
  | "fixed_amount"
  | "pct_of_basic"
  | "pct_of_ctc"
  | "pct_of_gross"
  | "pct_of_epf_base"
  | "balancing"
  | "kerala_slab"
  | "tds_projected";
export type StatutoryType = "epf" | "esic" | "pt" | "tds" | null;
export type PayrollCycleStatus = "draft" | "processing" | "review" | "finalized" | "paid";
export type PayrollEntryStatus = "pending" | "adjusted" | "finalized";

export interface WageComponent {
  id: string;
  name: string;
  type: WageComponentType;
  calculationType: CalculationType;
  value: number | null;
  isStatutory: boolean;
  statutoryType: StatutoryType;
  isTaxable: boolean;
  epfApplicable: boolean;
  order: number;
}

export interface ClientWageConfig {
  id: string; // = clientId
  clientId: string;
  clientName: string;
  components: WageComponent[];
  uploadedFromExcel: boolean;
  lastUpdatedAt: Timestamp;
  lastUpdatedBy: string;
}

export interface SalaryStructure {
  id: string;
  clientId: string;
  clientName: string;
  name: string; // e.g. "Guard Grade A"
  grossMonthly: number;
  componentAmounts: Record<string, number>;
  updatedAt?: Timestamp;
  updatedBy?: string;
  createdAt: Timestamp;
  createdBy: string;
}

export interface EmployeeSalary {
  id: string; // = employeeId
  employeeId: string;
  clientId: string;
  structureId: string;
  structureName: string;
  effectiveFrom: Timestamp;
  grossMonthly: number;
  componentOverrides: Record<string, number>;
  taxRegime: "new" | "old";
  stateCode?: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
  updatedBy: string;
  history: Array<{ date: string; by: string; changes: string }>;
}

export interface PayrollCycle {
  id: string;
  period: string; // YYYY-MM
  month: number;
  year: number;
  status: PayrollCycleStatus;
  totalEmployees: number;
  totalGross: number;
  totalNetPay: number;
  totalEPF: number;
  totalESIC: number;
  totalPT: number;
  totalTDS: number;
  processedAt?: Timestamp;
  finalizedAt?: Timestamp;
  paidAt?: Timestamp;
  processedBy?: string;
  finalizedBy?: string;
  notes?: string;
  createdAt: Timestamp;
}

export interface PayrollEntryEarnings {
  basic: number;
  hra: number;
  da: number;
  conveyance: number;
  specialAllowance: number;
  otherAllowances: number;
  overtimeAmount: number;
  grossEarnings: number;
  componentBreakdown?: Record<string, number>;
}

export interface PayrollEntryDeductions {
  epfEmployee: number;
  esicEmployee: number;
  professionalTax: number;
  tds: number;
  lopDeduction: number;
  otherDeductions: number;
  totalDeductions: number;
}

export interface PayrollEntry {
  id: string;
  cycleId: string;
  period: string; // YYYY-MM
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  clientId: string;
  clientName: string;
  district: string;
  workingDays: number;
  presentDays: number;
  payableDays?: number;
  approvedPaidLeaveDays?: number;
  approvedUnpaidLeaveDays?: number;
  lopDays: number;
  overtimeHours: number;
  overtimeAmount: number;
  earnings: PayrollEntryEarnings;
  deductions: PayrollEntryDeductions;
  employerContributions: { epfEmployer: number; esicEmployer: number };
  netPay: number;
  payslipUrl?: string;
  salaryStructureId?: string;
  salaryStructureName?: string;
  status: PayrollEntryStatus;
  adminNotes?: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface PTSlab {
  upTo: number | null;
  monthly: number;
}

export interface TDSSlab {
  upTo: number | null;
  rate: number;
}

export interface ComplianceSettings {
  epf: {
    employeeRate: number;
    employerEpsRate: number;
    employerEpfRate: number;
    wageCeiling: number;
    maxEmployerContribution: number;
  };
  esic: {
    employeeRate: number;
    employerRate: number;
    grossWageCeiling: number;
  };
  professionalTax: {
    state: string;
    slabs: PTSlab[];
  };
  tds: {
    regime: "new" | "old";
    standardDeduction: number;
    slabs: TDSSlab[];
  };
  bonus: {
    rate: number;
    minimumWageBase: number;
  };
  gratuity: {
    rate: number;
    minimumYearsForPayout: number;
  };
  updatedAt?: Timestamp;
  updatedBy?: string;
  changeHistory?: Array<{
    at: string;
    by: string;
    summary: string;
  }>;
}
