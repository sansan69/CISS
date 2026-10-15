import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatIstDate, formatIstDutyDateLabel } from './ist-date';

// Regression for the finding "FO exam headings and the manual dialog show the
// browser's local date instead of the canonical IST duty date". The duty below
// starts at IST midnight, so its UTC timestamp still falls on the previous day.
const istMidnightDuty = new Date('2026-10-19T18:30:00.000Z');
const originalTimeZone = process.env.TZ;

beforeAll(() => {
  process.env.TZ = 'UTC';
});
afterAll(() => {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
});

describe('IST duty date presentation', () => {
  it('labels an IST-midnight duty with its IST duty date on a non-IST browser', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
    // Un-zoned formatting is what the FO panel used to show supervisors.
    expect(istMidnightDuty.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})).toBe('Mon 19 Oct');

    expect(formatIstDutyDateLabel(istMidnightDuty)).toBe('Tue 20 Oct');
    expect(formatIstDate(istMidnightDuty)).toBe('2026-10-20');
  });

  it('keeps the displayed heading on the same duty date as the group key', () => {
    const dutyDate = new Date('2026-06-30T18:30:00.000Z');
    expect(formatIstDate(dutyDate)).toBe('2026-07-01');
    expect(formatIstDutyDateLabel(dutyDate)).toBe('Wed 1 Jul');
  });
});
