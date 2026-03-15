import { Timestamp, serverTimestamp } from "firebase/firestore";
import { auth } from "@/lib/firebase";

type AuditActor = {
  uid?: string | null;
  email?: string | null;
};

function resolveActor(actor?: AuditActor) {
  const currentUser = auth.currentUser;
  return {
    uid: actor?.uid ?? currentUser?.uid ?? null,
    email: actor?.email ?? currentUser?.email ?? null,
  };
}

export function buildFirestoreCreateAudit(actor?: AuditActor) {
  const resolvedActor = resolveActor(actor);
  return {
    createdAt: serverTimestamp(),
    createdBy: resolvedActor.uid,
    createdByEmail: resolvedActor.email,
    updatedAt: serverTimestamp(),
    updatedBy: resolvedActor.uid,
    updatedByEmail: resolvedActor.email,
  };
}

export function buildFirestoreUpdateAudit(actor?: AuditActor) {
  const resolvedActor = resolveActor(actor);
  return {
    updatedAt: serverTimestamp(),
    updatedBy: resolvedActor.uid,
    updatedByEmail: resolvedActor.email,
  };
}

export function buildFirestoreAuditEvent(
  action: string,
  actor?: AuditActor,
  details: Record<string, unknown> = {},
) {
  const resolvedActor = resolveActor(actor);
  return {
    action,
    at: Timestamp.now(),
    by: resolvedActor.uid,
    byEmail: resolvedActor.email,
    ...details,
  };
}
