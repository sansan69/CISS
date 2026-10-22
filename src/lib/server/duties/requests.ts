import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { log } from '@/lib/server/log';
import { isContentionError } from './retry';
export class DutyError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}
export function invalid(message = 'Invalid duty request.'): never {
  throw new DutyError(400, 'invalid_body', message);
}
export function documentId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 500 || value.includes('/') || value === '.' || value === '..')
    invalid('Invalid document id.');
  return value;
}
export function requestId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    invalid('A UUID clientRequestId is required.');
  return value;
}
export function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    invalid('expectedVersion must be a nonnegative integer.');
  return Number(value);
}
export function strictBody(input: unknown, fields: string[]): Record<string, any> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !fields.includes(k)))
    invalid();
  return input as Record<string, any>;
}
export function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function fingerprint(input: Record<string, unknown>) {
  return hash(Object.fromEntries(Object.entries(input).filter(([k]) => k !== 'clientRequestId').sort(([a], [b]) => a.localeCompare(b))));
}
export function receiptRef(db: FirebaseFirestore.Firestore, kind: string, uid: string, entity: string, id: string) {
  return db.collection('dutyRequests').doc(hash([kind, uid, entity, id]));
}
export function replayReceipt(snapshot: FirebaseFirestore.DocumentSnapshot, fp: string) {
  if (!snapshot.exists)
    return null;
  const data = snapshot.data()!;
  if (data.fingerprint !== fp)
    throw new DutyError(409, 'request_conflict', 'Request ID was already used with a different payload.');
  return data;
}
export function assertVersion(expected: number, current: number, details: Record<string, unknown>) {
  if (expected !== current)
    throw new DutyError(409, 'version_conflict', 'Duty state changed. Refresh before retrying.', details);
}
export function iso(value: unknown): string | null {
  if (typeof value === 'string')
    return value;
  const d = value instanceof Date ? value : (value as {
    toDate?: () => Date;
  })?.toDate?.();
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}
const sessionCodes = new Set(['auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired', 'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found']);
export function dutyErrorResponse(error: unknown) {
  const e = error as {
    message?: string;
    code?: string;
  };
  if (error instanceof DutyError)
    return NextResponse.json({
      error: error.message,
      code: error.code,
      ...error.details
    }, {
      status: error.status,
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  if (e.message === 'Missing bearer token.' || sessionCodes.has(e.code ?? ''))
    return NextResponse.json({
      error: 'Invalid session.',
      code: 'invalid_session'
    }, {
      status: 401,
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  // Contention is a "try again" condition, not a lost save: answer 503 with a
  // retryable code so the console can re-issue the request instead of telling
  // the supervisor the assignment failed.
  if (isContentionError(error)) {
    log('warn', 'duties', 'Duty request hit storage contention', {
      code: e.code,
      message: e.message
    });
    return NextResponse.json({
      error: 'The duty roster is busy with another save. Try again in a moment.',
      code: 'busy',
      retryable: true
    }, {
      status: 503,
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  }
  log('error', 'duties', 'Duty request failed', {
    code: e.code,
    message: e.message
  });
  return NextResponse.json({
    error: 'Could not process duty request.',
    code: 'internal_error'
  }, {
    status: 500,
    headers: {
      'Cache-Control': 'private, no-store'
    }
  });
}
export function dutyJson(value: unknown) {
  return NextResponse.json(value, {
    headers: {
      'Cache-Control': 'private, no-store'
    }
  });
}
export async function readJson(request: Request) {
  try {
    return await request.json();
  }
  catch {
    invalid('Invalid JSON body.');
  }
}
