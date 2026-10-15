"use client";

import { auth } from "@/lib/firebase";

import type { DutyOwner } from "./duty-scheduling";

/**
 * The identity (and API origin) an in-flight duty batch belongs to. Read once
 * when the batch is prepared so later items and retries can never silently run
 * as whichever account the global auth shell happens to hold at that moment.
 */
export function readDutyOwner(): DutyOwner | null {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  return {
    uid,
    origin: typeof window === "undefined" ? "" : window.location.origin,
  };
}
