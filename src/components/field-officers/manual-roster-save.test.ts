import { describe, expect, it } from 'vitest';
import {
  loadWorkOrderRoster,
  prepareManualRosterRequest,
  retainedRosterMutation,
  submitRosterRequest,
  type DutyMutation,
} from './duty-scheduling';

// Regressions for the finding "the retained manual roster dialog bypasses the
// version/receipt contract". The manual dialog reads the current roster and
// `assignmentVersion` when it opens, submits that version, and keeps one
// identical UUID/body across uncertain retries.

const one = {uid:'one-doc',name:'Guard one',employeeId:'CISS/KL/1',gender:'Male'};
const two = {uid:'two-doc',name:'Guard two',employeeId:'CISS/KL/2',gender:'Female'};

describe('manual roster save contract', () => {
  it('reads the current roster and version from the duty detail API', async () => {
    const urls: string[] = [];
    const fetcher = async (url: string) => {
      urls.push(url);
      return Response.json({id:'exam-fixture',assignedGuards:[one],assignmentVersion:4});
    };
    await expect(loadWorkOrderRoster('exam-fixture',fetcher)).resolves.toEqual({assignedGuards:[one],assignmentVersion:4});
    expect(urls).toEqual(['/api/admin/work-orders/exam-fixture']);
    const empty = async (url: string) => { urls.push(url); return Response.json({id:'exam-fixture'}); };
    await expect(loadWorkOrderRoster('exam fixture/../other',empty)).resolves.toEqual({assignedGuards:[],assignmentVersion:0});
    expect(urls[1]).toBe('/api/admin/work-orders/exam%20fixture%2F..%2Fother');
  });

  it('submits the loaded roster with its version and a request receipt', () => {
    const request = prepareManualRosterRequest('exam-fixture',[one,two],4,()=> 'fixture-receipt');
    expect(request).toEqual({
      url:'/api/admin/work-orders/exam-fixture',
      method:'PATCH',
      employeeDocId:null,
      body:{assignedGuards:[one,two],expectedVersion:4,clientRequestId:'fixture-receipt'},
    });
  });

  it('retries an uncertain save with an identical body and receipt', async () => {
    const attempts: { url: string; body: any }[] = [];
    let failNext = true;
    const fetcher = async (url: string, init: RequestInit) => {
      attempts.push({url,body:JSON.parse(String(init.body))});
      if (failNext) {
        failNext = false;
        throw new Error('Connection lost');
      }
      return Response.json({id:'exam-fixture'});
    };
    let pending: DutyMutation | null = retainedRosterMutation(null,'exam-fixture',[one],4,()=> 'fixture-receipt');
    const first = await submitRosterRequest(pending,fetcher);
    expect(first).toMatchObject({status:'uncertain',retryable:true,versionConflict:false});

    // Retry reuses the retained request even if the selector changed meanwhile,
    // so an unconfirmed write can never be re-issued as a different payload.
    pending = retainedRosterMutation(first.status === 'uncertain' ? pending : null,'exam-fixture',[two],9,()=> 'second-receipt');
    const second = await submitRosterRequest(pending,fetcher);
    expect(second).toMatchObject({status:'saved',retryable:false});
    expect(attempts.map((attempt) => attempt.body)).toEqual([
      {assignedGuards:[one],expectedVersion:4,clientRequestId:'fixture-receipt'},
      {assignedGuards:[one],expectedVersion:4,clientRequestId:'fixture-receipt'},
    ]);
  });

  it('reports a version conflict as terminal so the dialog must reload and reselect', async () => {
    const conflict = async () => Response.json({error:'Duty state changed. Refresh before retrying.',code:'version_conflict'},{status:409});
    const outcome = await submitRosterRequest(prepareManualRosterRequest('exam-fixture',[one],4,()=> 'fixture-receipt'),conflict);
    expect(outcome).toMatchObject({status:'rejected',retryable:false,versionConflict:true,code:'version_conflict'});
    expect(outcome.message).toContain('Duty state changed');

    const sameDay = async () => Response.json({error:'Guard one is already assigned to Centre on this date.',code:'roster_conflict'},{status:409});
    await expect(submitRosterRequest(prepareManualRosterRequest('exam-fixture',[one],4,()=> 'fixture-receipt'),sameDay))
      .resolves.toMatchObject({status:'rejected',retryable:false,versionConflict:false,code:'roster_conflict'});
  });
});
