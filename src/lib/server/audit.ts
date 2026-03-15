type AuditActor = {
  uid?: string | null;
  email?: string | null;
};

function normalizeActor(actor?: AuditActor) {
  return {
    uid: actor?.uid ?? null,
    email: actor?.email ?? null,
  };
}

export function buildServerCreateAudit(actor?: AuditActor) {
  const resolvedActor = normalizeActor(actor);
  const now = new Date();
  return {
    createdAt: now,
    createdBy: resolvedActor.uid,
    createdByEmail: resolvedActor.email,
    updatedAt: now,
    updatedBy: resolvedActor.uid,
    updatedByEmail: resolvedActor.email,
  };
}

export function buildServerUpdateAudit(actor?: AuditActor) {
  const resolvedActor = normalizeActor(actor);
  return {
    updatedAt: new Date(),
    updatedBy: resolvedActor.uid,
    updatedByEmail: resolvedActor.email,
  };
}

export function buildServerAuditEvent(
  action: string,
  actor?: AuditActor,
  details: Record<string, unknown> = {},
) {
  const resolvedActor = normalizeActor(actor);
  return {
    action,
    at: new Date(),
    by: resolvedActor.uid,
    byEmail: resolvedActor.email,
    ...details,
  };
}
