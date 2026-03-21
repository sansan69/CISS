export type AppRole = "admin" | "fieldOfficer" | "client" | "user" | "superAdmin" | "guard";

export interface ResolvedAppUser {
  role: AppRole;
  assignedDistricts: string[];
  clientId?: string;
  clientName?: string;
  stateCode?: string | null;
  isSuperAdmin?: boolean;
  employeeId?: string;
  employeeDocId?: string;
}
