import { beforeEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => vi.fn());
const profile = vi.hoisted(() => vi.fn());
const add = vi.hoisted(() => vi.fn());
vi.mock('@/lib/server/auth', () => ({verifyRequestAuth: auth, hasAdminAccess: (u: {role: string}) => u.role === 'admin', hasFieldOfficerAccess: (u: {role: string}) => u.role === 'fieldOfficer'}));
vi.mock('@/lib/server/linked-profiles', () => ({requireActiveFieldOfficerProfile: profile}));
vi.mock('@/lib/firebaseAdmin', () => ({db: {collection: (name: string) => name === 'employeeAccessAudit' ? {add} : {doc: () => ({get: async () => ({exists: true, data: () => ({district:'Kollam'})})})}}}));
import { POST } from './route';
describe('employee access audit', () => {
 beforeEach(() => {vi.clearAllMocks(); auth.mockResolvedValue({uid:'fo', role:'fieldOfficer'}); profile.mockResolvedValue({assignedDistricts:['Kollam']}); add.mockResolvedValue({id:'a'});});
 const request = () => new Request('http://localhost/api/field-officer/employee-access', {method:'POST', body: JSON.stringify({employeeDocId:'guard-1', name:'must not log'})});
 it('audits scoped access with a retention expiry and no submitted PII', async () => {
   expect((await POST(request())).status).toBe(200);
   expect(add).toHaveBeenCalledWith(expect.objectContaining({actorUid:'fo', employeeDocId:'guard-1', action:'employee_opened', expiresAt:expect.any(Date)}));
   expect(add.mock.calls[0][0]).not.toHaveProperty('name');
   const event = add.mock.calls[0][0];
   expect(event.expiresAt.getTime() - event.at.getTime()).toBe(366 * 86400000);
 });
 it('does not audit an out-of-scope employee', async () => {
   profile.mockResolvedValue({assignedDistricts:['Ernakulam']});
   expect((await POST(request())).status).toBe(403); expect(add).not.toHaveBeenCalled();
 });
 it('fails visibly if durable audit cannot be written', async () => {
   add.mockRejectedValue(new Error('store down'));
   expect((await POST(request())).status).toBe(503);
 });
});
