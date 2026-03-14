export type AppRole = "admin" | "fieldOfficer" | "client" | "user";

export interface ResolvedAppUser {
  role: AppRole;
  assignedDistricts: string[];
  clientId?: string;
  clientName?: string;
}
