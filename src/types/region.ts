export type RegionStatus =
  | "draft"
  | "config_pending"
  | "validated"
  | "seeded"
  | "ready"
  | "live"
  | "suspended"
  | "error";

/**
 * How a region's Firebase backend was obtained.
 *
 * - `byo_firebase`: the state owns its own Firebase project (created and owned by
 *   its Google account) and hands us the web config, an optional Android
 *   google-services.json, a service-account key, and the domains that may serve
 *   its app. We never create a GCP project in this mode.
 * - `automated`: provisioned by the Super Admin automation (GCP project created
 *   and apps generated on our behalf).
 */
export type RegionOnboardingMode = "byo_firebase" | "automated";

export interface RegionOnboardingChecklist {
  metadataSaved: boolean;
  firebaseValidated: boolean;
  defaultsSeeded: boolean;
  regionAdminCreated: boolean;
  vercelConfigured: boolean;
  /** Firestore + Storage security rules released against the region project. */
  rulesDeployed?: boolean;
  /** Composite Firestore indexes created (idempotent) against the region project. */
  indexesDeployed?: boolean;
  /** The region's Storage bucket answered a metadata call with the region service account. */
  storageBucketVerified?: boolean;
  lastValidatedAt?: unknown;
  lastSeededAt?: unknown;
  lastAdminCreatedAt?: unknown;
}

/** Outcome of the last `POST /regions/[id]/database-setup` run. */
export interface RegionDatabaseSetup {
  rulesDeployedAt?: unknown;
  storageRulesDeployedAt?: unknown;
  bucketVerifiedAt?: unknown;
  indexes?: {
    created: number;
    existing: number;
    /** Indexes whose creation was accepted but not yet READY within the wait cap. */
    pending: number;
    deployedAt?: unknown;
  };
  lastAttemptAt?: unknown;
  lastError?: string | null;
}

export type RegionDatabaseSetupStepId =
  | "bucket"
  | "firestoreRules"
  | "storageRules"
  | "indexes";

export interface RegionDatabaseSetupStep {
  step: RegionDatabaseSetupStepId;
  status: "deployed" | "verified" | "skipped" | "failed";
  message?: string;
  created?: number;
  existing?: number;
  pending?: number;
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
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt: string;
  completedAt?: string;
  elapsedMs?: number;
  error?: string;
  result?: Record<string, unknown>;
}

export interface AutomationJob {
  id: string;
  regionCode: string;
  status: "queued" | "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  currentStepIndex: number;
  steps: AutomationStepResult[];
  error?: string;
  queuedAt?: string;
  claimedAt?: string;
  workerId?: string;
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
  /** Android application id (package name) registered in the state's Firebase project. */
  androidPackageName?: string | null;
  /** Hostnames allowed to serve this region's app. Empty/absent means "not locked". */
  allowedDomains?: string[];
  onboardingMode?: RegionOnboardingMode;
  /** Outcome of the last database-setup run (rules, indexes, bucket). */
  databaseSetup?: RegionDatabaseSetup | null;
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
  // BYO-Firebase inputs: the Android client and the host lock are optional.
  androidAppId?: string | null;
  androidApiKey?: string | null;
  androidPackageName?: string | null;
  /** Array or a newline/comma separated string; normalised before it is stored. */
  allowedDomains?: string[] | string | null;
  onboardingMode?: RegionOnboardingMode;
}

/** Android client config extracted from a state's `google-services.json`. */
export interface AndroidGoogleServicesConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  packageName: string;
}

/**
 * Body of `POST /api/super-admin/regions` for BYO-Firebase state enrollment.
 *
 * The service account is transport-only: it is validated, encrypted with
 * `saveRegionConnection`, and never written to the region document or returned.
 */
export interface RegionOnboardingInput extends RegionWebConfigInput {
  regionCode: string;
  regionName: string;
  regionAdminEmail?: string | null;
  serviceAccountJson?: string | null;
  serviceAccountBase64?: string | null;
  googleServicesJson?: string | null;
}
