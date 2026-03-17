export type AppRole = "admin" | "fieldOfficer" | "client" | "user" | "superAdmin";

export interface ResolvedAppUser {
  role: AppRole;
  assignedDistricts: string[];
  clientId?: string;
  clientName?: string;
  stateCode?: string | null;
  isSuperAdmin?: boolean;
}
