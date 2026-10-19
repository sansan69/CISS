import { describe, expect, it } from 'vitest';
import { guardLeaveSchema } from './guard-leave-validation';
describe('guard leave validation',()=>{
 const valid={type:'Annual',startDate:'2026-10-18',endDate:'2026-10-19',reason:'Family'};
 it('accepts dates used by both clients',()=>{expect(guardLeaveSchema.parse({...valid,startDate:'2026-10-18T00:00:00.000Z'}).startDate).toBe('2026-10-18');});
 it('rejects invalid or reversed dates and empty reasons',()=>{
  expect(guardLeaveSchema.safeParse({...valid,endDate:'2026-10-17'}).success).toBe(false);
  expect(guardLeaveSchema.safeParse({...valid,startDate:'2026-02-30'}).success).toBe(false);
  expect(guardLeaveSchema.safeParse({...valid,reason:' '}).success).toBe(false);
 });
});
