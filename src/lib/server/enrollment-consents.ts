import crypto from "node:crypto";
import {
  ENROLLMENT_TERMS_TEXT,
  ENROLLMENT_TERMS_VERSION,
  GUARD_UNDERTAKING_TEXT,
  GUARD_UNDERTAKING_VERSION,
} from "@/lib/enrollment-consents";

export { ENROLLMENT_TERMS_VERSION, GUARD_UNDERTAKING_VERSION };

export const ENROLLMENT_TERMS_TEXT_HASH = crypto
  .createHash("sha256")
  .update(ENROLLMENT_TERMS_TEXT, "utf8")
  .digest("hex");

export const GUARD_UNDERTAKING_TEXT_HASH = crypto
  .createHash("sha256")
  .update(GUARD_UNDERTAKING_TEXT, "utf8")
  .digest("hex");
