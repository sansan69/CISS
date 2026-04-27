export const KERALA_DISTRICTS = [
  "Thiruvananthapuram",
  "Kollam",
  "Pathanamthitta",
  "Alappuzha",
  "Kottayam",
  "Idukki",
  "Ernakulam",
  "Thrissur",
  "Palakkad",
  "Malappuram",
  "Kozhikode",
  "Wayanad",
  "Kannur",
  "Kasaragod",
  "Lakshadweep",
] as const;

export const EMPLOYEE_STATUSES = [
  "Active",
  "Inactive",
  "OnLeave",
  "Exited",
] as const;

export const PROOF_TYPES = [
  "Aadhar Card",
  "PAN Card",
  "Voter ID",
  "Passport",
  "Driving License",
  "Birth Certificate",
  "School Certificate",
] as const;

export const EDUCATION_OPTIONS = [
  "Primary School",
  "High School",
  "Matriculation/10th",
  "Pre degree/+2 Equivalent",
  "Diploma",
  "Graduation",
  "Graduate",
  "Post Graduation",
  "Post graduate",
  "Doctorate",
  "Any Other Qualification",
] as const;

export const MARITAL_STATUSES = ["Married", "Unmarried"] as const;

export const GENDER_OPTIONS = ["Male", "Female", "Other"] as const;

export const OPERATIONAL_CLIENT_NAME = "TCS" as const;
export const LNG_CLIENT_NAME = "LNG Petronet" as const;
export const LNG_JOB_DESIGNATIONS = [
  "Ex Servicemen Security Guard - Military",
  "Ex Servicemen Security Guard - Paramilitary",
  "Supervisor",
  "Console Operator",
  "Armed Guard (Gunman) - Military",
  "Armed Guard (Gunman) - Paramilitary",
  "Lady Security Guard",
] as const;
export const LNG_SERVICE_BOOK_REQUIRED_DESIGNATIONS = [
  "Ex Servicemen Security Guard - Military",
  "Ex Servicemen Security Guard - Paramilitary",
  "Supervisor",
  "Armed Guard (Gunman) - Military",
  "Armed Guard (Gunman) - Paramilitary",
] as const;
export const LNG_ARMS_LICENSE_REQUIRED_DESIGNATIONS = [
  "Armed Guard (Gunman) - Military",
  "Armed Guard (Gunman) - Paramilitary",
] as const;

const LNG_SERVICE_BOOK_REQUIRED_SET = new Set<string>(LNG_SERVICE_BOOK_REQUIRED_DESIGNATIONS);
const LNG_ARMS_LICENSE_REQUIRED_SET = new Set<string>(LNG_ARMS_LICENSE_REQUIRED_DESIGNATIONS);

export function requiresLngServiceBook(designation?: string | null) {
  return Boolean(designation && LNG_SERVICE_BOOK_REQUIRED_SET.has(designation));
}

export function requiresLngArmsLicense(designation?: string | null) {
  return Boolean(designation && LNG_ARMS_LICENSE_REQUIRED_SET.has(designation));
}
export const DEFAULT_GEOFENCE_RADIUS_METERS = 150;
export const DEFAULT_GPS_ACCURACY_LIMIT_METERS = 100;
export const OFFLINE_ATTENDANCE_MAX_AGE_HOURS = 4;

const configuredLegacyAdminEmails = [
  process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL,
  process.env.SUPER_ADMIN_EMAIL,
  "admin@cisskerala.app",
]
  .filter(Boolean)
  .flatMap((value) => (value ?? "").split(","))
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export const LEGACY_ADMIN_EMAILS = Array.from(new Set(configuredLegacyAdminEmails));
