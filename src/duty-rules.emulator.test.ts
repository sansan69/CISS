import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
const host = process.env.FIRESTORE_EMULATOR_HOST;
const project = 'demo-ciss-duty-rules';
const base = `http://${host}`;
const run = randomUUID();
function token(role: string) {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${enc({
    alg: 'none',
    typ: 'JWT'
  })}.${enc({
    iss: `https://securetoken.google.com/${project}`,
    aud: project,
    sub: `local-${role}`,
    user_id: `local-${role}`,
    iat: now,
    exp: now + 3600,
    role,
    admin: false,
    stateCode: 'KL',
    email: `${role}@local.example`
  })}.`;
}
function fields(data: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typeof v === 'boolean' ? {
      booleanValue: v
    } : typeof v === 'number' ? {
      integerValue: String(v)
    } : {
      stringValue: String(v)
    }]));
}
async function access(collection: string, id: string, role: string, method = 'GET', data: Record<string, unknown> = {}) {
  return fetch(`${base}/v1/projects/${project}/databases/(default)/documents/${collection}/${id}-${run}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${role === 'owner' ? 'owner' : token(role)}`
    },
    ...(method === 'PATCH' ? {
      body: JSON.stringify({
        fields: fields(data)
      })
    } : {})
  });
}
describe.skipIf(!host)('duty access Firestore rules (local emulator)', () => {
  beforeAll(async () => {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname))
      throw new Error('Loopback emulator required.');
    const response = await fetch(`${base}/emulator/v1/projects/${project}:securityRules`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer owner'
      },
      body: JSON.stringify({
        rules: {
          files: [{
              name: 'firestore.rules',
              content: readFileSync(process.env.DUTY_RULES_PATH || 'firestore.rules', 'utf8')
            }]
        }
      })
    });
    expect(response.ok).toBe(true);
    const result = await response.json();
    expect((result.issues ?? []).filter((v: any) => v.severity === 'ERROR')).toEqual([]);
  });
  for (const collection of ['dutyWillingness', 'dutyRequests', 'guardAssignments', 'guardAssignmentSlots'])
    for (const role of ['guard', 'fieldOfficer', 'admin', 'superAdmin'])
      it(`denies direct read/write ${collection} by ${role}`, async () => {
        const id = `${collection}-${role}`;
        expect((await access(collection, id, 'owner', 'PATCH', {
          guardUid: 'local-guard',
          district: 'Ernakulam'
        })).status).toBe(200);
        expect((await access(collection, id, role)).status).toBe(403);
        expect((await access(collection, id, role, 'PATCH', {
          guardUid: 'local-guard',
          district: 'Ernakulam'
        })).status).toBe(403);
      });
  it('duty inbox is readable only by recipient or admin, guards may mark read', async () => {
    const id = 'visibility';
    const value = {
      recipientUid: 'local-guard',
      type: 'duty_assigned',
      read: false,
      dutyEvent: true,
      pushStatus: 'pending'
    };
    expect((await access('notifications', id, 'owner', 'PATCH', value)).status).toBe(200);
    expect((await access('notifications', id, 'guard')).status).toBe(200);
    expect((await access('notifications', id, 'fieldOfficer')).status).toBe(403);
    expect((await access('notifications', id, 'guard', 'PATCH', {
      ...value,
      read: true
    })).status).toBe(200);
    expect((await access('notifications', id, 'guard', 'PATCH', {
      ...value,
      read: true,
      pushStatus: 'sent'
    })).status).toBe(403);
  });
  it('admin cannot forge server duty event ownership', async () => {
    expect((await access('notifications', 'forged', 'admin', 'PATCH', {
      recipientUid: 'local-guard',
      dutyEvent: true,
      type: 'duty_assigned',
      read: false,
      pushStatus: 'sent'
    })).status).toBe(403);
  });
  it('admin cannot reset recipient read state or alter/delete duty delivery state', async () => {
    const id = 'delivery';
    const value = {
      recipientUid: 'local-guard',
      type: 'duty_changed',
      read: true,
      dutyEvent: true,
      pushStatus: 'pending'
    };
    expect((await access('notifications', id, 'owner', 'PATCH', value)).status).toBe(200);
    expect((await access('notifications', id, 'admin', 'PATCH', {
      ...value,
      read: false,
      pushStatus: 'sent'
    })).status).toBe(403);
    expect((await access('notifications', id, 'admin', 'DELETE')).status).toBe(403);
  });
});
