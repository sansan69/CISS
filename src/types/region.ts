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
  isCurrentRegion?: boolean;
  isSynthetic?: boolean;
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
    onLeaveEmployees: number;
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
  onLeaveEmployees: number;
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
