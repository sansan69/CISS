export type RegionStatus =
  | "draft"
  | "config_pending"
  | "validated"
  | "seeded"
  | "ready"
  | "live"
  | "suspended"
  | "error";

export interface RegionOnboardingChecklist {
  metadataSaved: boolean;
  firebaseValidated: boolean;
  defaultsSeeded: boolean;
  regionAdminCreated: boolean;
  vercelConfigured: boolean;
  lastValidatedAt?: unknown;
  lastSeededAt?: unknown;
  lastAdminCreatedAt?: unknown;
}

export interface RegionValidationChecks {
  projectIdMatches: boolean;
  firestoreReachable: boolean;
  authReachable: boolean;
  storageReachable: boolean;
}

export interface RegionValidationSummary {
  checks: RegionValidationChecks;
  messages: string[];
  validatedAt?: unknown;
}

export type AutomationStepId =
  | "preflight"
  | "create_gcp_project"
  | "enable_apis"
  | "add_firebase"
  | "provision_firestore"
  | "enable_auth"
  | "create_apps"
  | "collect_sdk_configs"
  | "deploy_rules"
  | "seed_defaults"
  | "generate_service_account"
  | "create_admin"
  | "provision_vercel"
  | "verify_ready";

export interface AutomationStepResult {
  stepId: AutomationStepId;
  status: "running" | "completed" | "failed" | "skipped";
  startedAt: string;
  completedAt?: string;
  elapsedMs?: number;
  error?: string;
  result?: Record<string, unknown>;
}

export interface AutomationJob {
  id: string;
  regionCode: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  currentStepIndex: number;
  steps: AutomationStepResult[];
  error?: string;
}

export interface PreflightCheckResult {
  checkId: string;
  label: string;
  passed: boolean;
  message: string;
}

export interface PreflightSummary {
  allPassed: boolean;
  checks: PreflightCheckResult[];
  validatedAt: string;
}

export interface ReadinessCheckResult {
  checkId: string;
  label: string;
  passed: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface ReadinessSummary {
  healthy: boolean;
  regionCode: string;
  checks: ReadinessCheckResult[];
  checkedAt: string;
}

export interface EnrollmentFormFieldConfig {
  key: string;
  label: string;
  enabled: boolean;
  required: boolean;
  order: number;
}

export interface EnrollmentFormSectionConfig {
  label: string;
  fields: EnrollmentFormFieldConfig[];
}

export interface EnrollmentFormConfig {
  sections: Record<string, EnrollmentFormSectionConfig>;
  clientOverrides?: Record<string, Record<string, Record<string, Partial<EnrollmentFormFieldConfig>>>>;
}

export interface RegionSetupProgress {
  setupComplete: boolean;
  startedAt?: string;
  completedAt?: string;
  currentStep: number;
  steps: {
    profile: boolean;
    districts: boolean;
    enrollmentConfig: boolean;
    clients: boolean;
    fieldOfficers: boolean;
    verify: boolean;
  };
}

export interface RegionRecord {
  id: string;
  regionCode: string;
  regionName: string;
  status: RegionStatus;
  firebaseProjectId: string;
  firebaseApiKey?: string | null;
  firebaseWebAppId?: string | null;
  storageBucket?: string | null;
  authDomain?: string | null;
  messagingSenderId?: string | null;
  measurementId?: string | null;
  regionAdminEmail?: string | null;
  appMode?: "regional";
  onboardingChecklist: RegionOnboardingChecklist;
  validationSummary?: RegionValidationSummary;
  seededDocs?: string[];
  lastRegionAdminUid?: string | null;
  persistentConnectionReady?: boolean;
  lastConnectionSavedAt?: unknown;
  vercelProjectName?: string | null;
  vercelProjectUrl?: string | null;
  vercelProductionUrl?: string | null;
  vercelTeamSlug?: string | null;
  lastVercelProvisionedAt?: unknown;
  androidApiKey?: string | null;
  androidAppId?: string | null;
  webApiKey?: string | null;
  webAppId?: string | null;
  isCurrentRegion?: boolean;
  isSynthetic?: boolean;
  automationJobId?: string | null;
  preflightSummary?: PreflightSummary | null;
  readonlySummary?: ReadinessSummary | null;
  createdAt?: unknown;
  createdBy?: string | null;
  updatedAt?: unknown;
  updatedBy?: string | null;
}

export interface RegionOverviewCard {
  regionCode: string;
  regionName: string;
  status: RegionStatus;
  firebaseProjectId: string;
  regionAdminEmail?: string | null;
  vercelProjectName?: string | null;
  vercelProjectUrl?: string | null;
  vercelProductionUrl?: string | null;
  connectionStatus: "connected" | "needs_credentials" | "error";
  connectionNote?: string;
  totals: {
    employees: number;
    activeEmployees: number;
    clients: number;
    fieldOfficers: number;
    attendanceToday: number;
    upcomingWorkOrders: number;
  };
  lastSyncedAt?: string;
}

export interface SuperAdminOverviewSummary {
  connectedRegions: number;
  totalRegions: number;
  employees: number;
  activeEmployees: number;
  clients: number;
  fieldOfficers: number;
  attendanceToday: number;
  upcomingWorkOrders: number;
}

export interface RegionCredentialInput {
  firebaseProjectId: string;
  storageBucket?: string | null;
  serviceAccountJson?: string | null;
  serviceAccountBase64?: string | null;
}

export interface RegionWebConfigInput {
  firebaseProjectId: string;
  firebaseApiKey?: string | null;
  firebaseWebAppId?: string | null;
  storageBucket?: string | null;
  authDomain?: string | null;
  messagingSenderId?: string | null;
  measurementId?: string | null;
}
