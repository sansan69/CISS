import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

/**
 * Regression cover for the production "Save Assignments → Assignment not saved /
 * Could not process duty request." incident.
 *
 * Every assignment save used to read `where("date", "==", …)` *inside* the
 * Firestore transaction. A transactional query read locks every duty on that
 * date, so while supervisors were assigning guards for the same exam day the
 * transactions aborted each other (`ABORTED: Transaction lock timeout`) and the
 * route reported a generic 500. This test assigns different centres on the same
 * date at the same time against the real Firestore emulator: every save must
 * succeed.
 */

const host = process.env.FIRESTORE_EMULATOR_HOST;
const project = 'demo-ciss-duty-contention';
const CENTRES = 60;
const DUTY_DATE = new Date('2026-10-23T06:30:00Z');

// Keep the emulator host active for the admin SDK and mock the module the route
// imports, so the route talks to the emulator instead of the real project.
const app = getApps().find((candidate) => candidate.name === '[DEFAULT]') ?? initializeApp({ projectId: project });
const db = getFirestore(app);

const token = { uid: 'admin-uid', role: 'admin', email: 'admin@ciss.in' };

vi.doMock('@/lib/firebaseAdmin', () => ({
  db,
  messaging: { sendEachForMulticast: vi.fn(async () => ({ failureCount: 0, successCount: 1 })) },
}));
vi.doMock('@/lib/server/auth', () => ({
  verifyRequestAuth: vi.fn(async () => token),
  requireAdminOrFieldOfficer: (candidate: any) => candidate,
  hasAdminAccess: (candidate: any) => candidate.role === 'admin' || candidate.role === 'superAdmin' || candidate.admin === true,
  hasFieldOfficerAccess: (candidate: any) => candidate.role === 'fieldOfficer',
  unauthorizedResponse: (error: string, status: number) => Response.json({ error }, { status }),
}));

async function clear(collection: string) {
  const snapshot = await db.collection(collection).get();
  await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
}

const roster = Array.from({ length: CENTRES }, (_, index) => ({
  workOrderId: `contention-duty-${index}`,
  guards: [1, 2].map((offset) => ({
    uid: `contention-emp-${index * 2 + offset}`,
    name: `GUARD ${index * 2 + offset}`,
    employeeId: `CISS/TCS/2025-26/${900 + index * 2 + offset}`,
    gender: offset === 1 ? 'Male' : 'Female',
  })),
}));

beforeAll(async () => {
  if (!host) return;
  for (const collection of ['sites', 'workOrders', 'employees', 'notifications', 'workOrderAssignmentEvents', 'dutyRequests']) {
    await clear(collection);
  }
  await db.collection('sites').doc('contention-site').set({
    siteName: 'Contention centre',
    clientName: 'TCS',
    district: 'Thrissur',
    status: 'active',
  });
  for (const { workOrderId, guards } of roster) {
    await db.collection('workOrders').doc(workOrderId).set({
      siteId: 'contention-site',
      siteName: `Centre ${workOrderId}`,
      clientName: 'TCS',
      district: 'Thrissur',
      date: Timestamp.fromDate(DUTY_DATE),
      recordStatus: 'active',
      maleGuardsRequired: 1,
      femaleGuardsRequired: 1,
      totalManpower: 2,
      assignedGuards: [],
      assignmentVersion: 0,
    });
    for (const guard of guards) {
      await db.collection('employees').doc(guard.uid).set({
        employeeId: guard.employeeId,
        fullName: guard.name,
        gender: guard.gender,
        district: 'Thrissur',
        status: 'Active',
        guardAuthUid: `auth-${guard.uid}`,
      });
    }
  }
}, 120000);

afterAll(async () => {
  if (!host) return;
  for (const collection of ['sites', 'workOrders', 'employees', 'notifications', 'workOrderAssignmentEvents', 'dutyRequests']) {
    await clear(collection);
  }
}, 120000);

describe.skipIf(!host)('exam roster saves under contention (local emulator)', () => {
  it('saves every centre when supervisors assign the same date concurrently', async () => {
    const { PATCH } = await import('@/app/api/admin/work-orders/[id]/route');

    const responses = await Promise.all(
      roster.map(({ workOrderId, guards }) =>
        PATCH(
          new Request('http://local/api', {
            method: 'PATCH',
            body: JSON.stringify({ assignedGuards: guards }),
          }),
          { params: Promise.resolve({ id: workOrderId }) },
        ),
      ),
    );

    const failures: string[] = [];
    for (const [index, response] of responses.entries()) {
      if (response.status !== 200) {
        failures.push(`${roster[index].workOrderId}: ${response.status} ${await response.text()}`);
      }
    }
    expect(failures).toEqual([]);

    for (const { workOrderId, guards } of roster) {
      const stored = (await db.collection('workOrders').doc(workOrderId).get()).data();
      expect(stored?.assignedGuards).toEqual(guards.map(({ uid, name, employeeId, gender }) => ({ uid, name, employeeId, gender })));
      expect(stored?.assignmentVersion).toBe(1);
    }
  }, 180000);
});
