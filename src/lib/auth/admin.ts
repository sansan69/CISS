import { LEGACY_ADMIN_EMAILS } from "@/lib/constants";

export function isLegacyAdminEmail(email: string | null | undefined) {
  return !!email && LEGACY_ADMIN_EMAILS.includes(email.trim().toLowerCase());
}
