import type { Timestamp } from "firebase/firestore";

export interface AssignedGuardSummary {
  uid: string;
  name: string;
  employeeId: string;
  gender: string;
}

export type WorkOrderLifecycleStatus = "active" | "cancelled" | "superseded" | "draft";
export type WorkOrderImportMode = "new" | "revision";
export type WorkOrderDuplicateResolution = "reject" | "replace" | "omit";
export type WorkOrderDiffStatus = "added" | "updated" | "unchanged" | "cancelled";
export type TcsExamParserMode = "legacy-sheet" | "pivot-date-sheet";
export type WorkOrderImportDuplicateState =
  | "none"
  | "binary-duplicate"
  | "content-duplicate"
  | "overlap";

export interface WorkOrder {
  id: string;
  siteId: string;
  siteName: string;
  clientName: string;
  district: string;
  date: Timestamp;
  maleGuardsRequired: number;
  femaleGuardsRequired: number;
  totalManpower: number;
  assignedGuards?: AssignedGuardSummary[];
  examName?: string;
  examCode?: string;
  recordStatus?: string;
  importId?: string;
  sourceFileName?: string;
  sourceSheetName?: string;
  binaryFileHash?: string;
  contentHash?: string;
}

export interface WorkOrderImportWarning {
  code: string;
  message: string;
  rowNumber?: number;
  sheetName?: string;
}

export interface TcsExamSourceRow {
  siteId?: string;
  siteName: string;
  district: string;
  date: string;
  maleGuardsRequired: number;
  femaleGuardsRequired: number;
  examName?: string;
  examCode?: string;
  sourceRowNumber?: number;
  sourceSheetName?: string;
}

export interface TcsExamWorkbookParseResult {
  parserMode: TcsExamParserMode;
  suggestedExamName: string;
  suggestedExamCode: string;
  dateRange: {
    from: string;
    to: string;
  };
  dates: string[];
  rows: TcsExamSourceRow[];
  siteCount: number;
  rowCount: number;
  totalMale: number;
  totalFemale: number;
  warnings: WorkOrderImportWarning[];
}

export interface TcsExamHashRow {
  siteId?: string;
  siteName: string;
  district: string;
  date: string;
  examCode: string;
  maleGuardsRequired: number;
  femaleGuardsRequired: number;
}

export interface TcsExamDiffRow extends TcsExamHashRow {
  key: string;
  totalManpower: number;
  status: WorkOrderDiffStatus;
  previousMaleGuardsRequired?: number;
  previousFemaleGuardsRequired?: number;
  previousTotalManpower?: number;
}

export interface TcsExamExistingWorkOrder extends TcsExamHashRow {
  id: string;
  examName?: string;
  totalManpower: number;
  recordStatus?: string;
}

export interface TcsExamImportPreviewPayload extends TcsExamWorkbookParseResult {
  mode: WorkOrderImportMode;
  binaryFileHash: string;
  contentHash: string;
  duplicateState: WorkOrderImportDuplicateState;
  duplicateMessage?: string;
  diffRows: TcsExamDiffRow[];
}

export interface TcsExamImportCommitPayload {
  mode?: WorkOrderImportMode;
  duplicateResolution?: WorkOrderDuplicateResolution;
  fileName: string;
  parserMode: TcsExamParserMode;
  examName: string;
  examCode: string;
  binaryFileHash: string;
  contentHash: string;
  rows: TcsExamSourceRow[];
  warnings?: WorkOrderImportWarning[];
}

export type WorkOrderTodoStatus = "pending" | "in-progress" | "completed" | "cancelled";
export type WorkOrderTodoPriority = "low" | "medium" | "high" | "urgent";

export interface WorkOrderTodo {
  id: string;
  title: string;
  description?: string;
  status: WorkOrderTodoStatus;
  priority: WorkOrderTodoPriority;
  workOrderId?: string;
  siteId?: string;
  siteName?: string;
  examName?: string;
  district?: string;
  dueDate?: string;
  assignedTo?: string;
  assignedToName?: string;
  createdBy: string;
  createdByName?: string;
  completedAt?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
