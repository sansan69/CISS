import { isContentionError, retryOnContention } from './retry';
import { expect, it, vi } from 'vitest';

const aborted = () => Object.assign(new Error('10 ABORTED: Transaction lock timeout.'), { code: 10 });

it('recognises Firestore contention failures', () => {
  expect(isContentionError(aborted())).toBe(true);
  expect(isContentionError({ code: '10', message: 'anything' })).toBe(true);
  expect(isContentionError({ code: 14, message: 'UNAVAILABLE' })).toBe(true);
  expect(isContentionError(new Error('DEADLINE_EXCEEDED: deadline exceeded'))).toBe(true);
  expect(isContentionError(new Error('4 ABORTED: Transaction has been aborted.'))).toBe(true);
});

it('does not treat ordinary failures as contention', () => {
  expect(isContentionError(new Error('commit failed'))).toBe(false);
  expect(isContentionError({ code: 7, message: 'PERMISSION_DENIED' })).toBe(false);
  expect(isContentionError(null)).toBe(false);
  expect(isContentionError('10 ABORTED')).toBe(false);
});

it('retries contention and returns the eventual result', async () => {
  const run = vi.fn()
    .mockImplementationOnce(async () => { throw aborted(); })
    .mockImplementationOnce(async () => { throw aborted(); })
    .mockImplementationOnce(async () => 'saved');

  const sleep = vi.fn(async () => undefined);
  await expect(retryOnContention(run, { attempts: 4, sleep, random: () => 0.5 })).resolves.toBe('saved');
  expect(run).toHaveBeenCalledTimes(3);
  expect(sleep).toHaveBeenCalledTimes(2);
  // Jittered exponential backoff, capped by maxDelayMs.
  for (const [delay] of sleep.mock.calls as unknown as [number][]) {
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(1500);
  }
});

it('stops immediately on a non-contention failure', async () => {
  const failure = new Error('commit failed');
  const run = vi.fn(async () => { throw failure; });
  const sleep = vi.fn(async () => undefined);

  await expect(retryOnContention(run, { attempts: 4, sleep })).rejects.toBe(failure);
  expect(run).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
});

it('rethrows the last contention error once the attempts are used up', async () => {
  const run = vi.fn(async () => { throw aborted(); });
  const sleep = vi.fn(async () => undefined);

  await expect(retryOnContention(run, { attempts: 3, sleep, random: () => 0 })).rejects.toMatchObject({ code: 10 });
  expect(run).toHaveBeenCalledTimes(3);
});

it('does not multiply deterministic duplicate-create failures wrapped as ABORTED', async () => {
  const duplicate = Object.assign(new Error('Document already exists: projects/example/databases/(default)/documents/notifications/old'),{code:10});
  expect(isContentionError(duplicate)).toBe(false);
  let attempts=0;
  await expect(retryOnContention(async () => {attempts++;throw duplicate;},{sleep:async()=>{}})).rejects.toBe(duplicate);
  expect(attempts).toBe(1);
});
