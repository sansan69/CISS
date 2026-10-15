import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('duty server-owned collections explicitly deny all browser/mobile access', () => {
  const rules = readFileSync('firestore.rules', 'utf8');
  for (const c of ['dutyWillingness', 'dutyRequests', 'guardAssignments', 'guardAssignmentSlots'])
    expect(rules).toMatch(new RegExp(`match /${c}/\\{[^}]+\\} \\{\\s*allow read, write: if false;`));
});
it('indexes cover every actual scoped date and pending push query', () => {
  const { indexes } = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'));
  for (const [collection, fields] of [['guardAssignments', ['guardId', 'date', '__name__']], ['guardAssignments', ['district', 'date', '__name__']], ['dutyWillingness', ['guardId', 'dutyDate', '__name__']], ['notifications', ['recipientUid', 'pushStatus', 'createdAt', '__name__']]] as [
    string,
    string[]
  ][]) {
    expect(indexes.some((i: any) => i.collectionGroup === collection && JSON.stringify(i.fields.map((f: any) => f.fieldPath)) === JSON.stringify(fields))).toBe(true);
  }
});
