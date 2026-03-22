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
  isCurrentRegion?: boolean;
  isSynthetic?: boolean;
  createdAt?: unknown;
  createdBy?: string | null;
  updatedAt?: unknown;
  updatedBy?: string | null;
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
