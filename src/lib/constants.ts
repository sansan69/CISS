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
  "Diploma",
  "Graduation",
  "Post Graduation",
  "Doctorate",
  "Any Other Qualification",
] as const;

export const MARITAL_STATUSES = ["Married", "Unmarried"] as const;

export const GENDER_OPTIONS = ["Male", "Female", "Other"] as const;

export const OPERATIONAL_CLIENT_NAME = "TCS" as const;
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
