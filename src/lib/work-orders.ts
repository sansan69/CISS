export function isWorkOrderAdminRole(userRole: string | null | undefined): boolean {
  return userRole === "admin" || userRole === "superAdmin";
}
