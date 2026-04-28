import { OPERATIONAL_CLIENT_NAME } from "@/lib/constants";

export function isWorkOrderAdminRole(userRole: string | null | undefined): boolean {
  return userRole === "admin" || userRole === "superAdmin";
}

export function normalizeWorkOrderClientName(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function isOperationalWorkOrderClientName(value: string | null | undefined): boolean {
  return normalizeWorkOrderClientName(value) === normalizeWorkOrderClientName(OPERATIONAL_CLIENT_NAME);
}
