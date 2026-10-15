import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync, linkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./plan-tcs-categories.mjs', import.meta.url));
const folders = [];
const source = (name) => ({ name, date: '2026-10-13', provenance: 'Synthetic fixture; no live export' });
const employee = (employeeDocId, extra = {}) => ({ employeeDocId, employeeId: `CISS/${employeeDocId}`, clientName: 'TCS', ...extra });

function fixture(employees = [], biometric = [], permanent = []) {
  const folder = mkdtempSync(join(tmpdir(), 'tcs-category-fixture-'));
  folders.push(folder);
  const paths = {
    employees: join(folder, 'employees.json'),
    biometric: join(folder, 'biometric.json'),
    permanent: join(folder, 'permanent.json'),
  };
  writeFileSync(paths.employees, JSON.stringify({ source: source('employee-export'), employees }));
  writeFileSync(paths.biometric, JSON.stringify({ source: source('biometric-candidates'), records: biometric }));
  writeFileSync(paths.permanent, JSON.stringify({ source: source('permanent-deployment'), records: permanent }));
  return { folder, paths };
}

function run(data, extra = []) {
  return spawnSync(process.execPath, [script, '--employees', data.paths.employees, '--biometric', data.paths.biometric, '--permanent', data.paths.permanent, ...extra], { encoding: 'utf8' });
}

function report(data) {
  const result = run(data);
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('offline TCS category proposal CLI', () => {
  it('uses permanent precedence and never classifies unlisted legacy employees', () => {
    const result = report(fixture([employee('a'), employee('b'), employee('c')], [{ employeeDocId: 'a' }, { employeeId: 'CISS/b' }], [{ employeeId: 'CISS/a' }]));
    expect(result.proposals.map(({ employeeDocId, proposedCategory }) => ({ employeeDocId, proposedCategory }))).toEqual([
      { employeeDocId: 'a', proposedCategory: 'permanent' },
      { employeeDocId: 'b', proposedCategory: 'adhoc' },
    ]);
    expect(result.proposals[0].evidence.map(({ source: name }) => name)).toEqual(['biometric', 'permanent']);
    expect(result.sources.permanent).toEqual(source('permanent-deployment'));
    expect(result.summary.unlistedEmployees).toBe(1);
  });

  it('preserves existing categories and reports an opposing source as a review conflict', () => {
    const result = report(fixture([employee('a', { tcsCategory: 'adhoc' }), employee('b', { tcsCategory: 'permanent' }), employee('c', { tcsCategory: 'permanent' })], [{ employeeDocId: 'b' }, { employeeDocId: 'c' }], [{ employeeDocId: 'a' }, { employeeDocId: 'c' }]));
    expect(result.proposals).toEqual([]);
    expect(result.conflicting.map(({ employeeDocId, existingCategory, proposedCategory, reason }) => ({ employeeDocId, existingCategory, proposedCategory, reason }))).toEqual([
      { employeeDocId: 'a', existingCategory: 'adhoc', proposedCategory: 'permanent', reason: 'curated_category_conflict' },
      { employeeDocId: 'b', existingCategory: 'permanent', proposedCategory: 'adhoc', reason: 'curated_category_conflict' },
    ]);
    expect(result.preserved).toEqual([expect.objectContaining({ employeeDocId: 'c', existingCategory: 'permanent' })]);
  });

  it('reports unknown, names-only and phones-only records without identity guessing', () => {
    const result = report(fixture([employee('a', { name: 'Same Name', phone: '9999999999' })], [{ employeeDocId: 'unknown' }, { name: 'Same Name' }, { phone: '9999999999' }, { employeeId: 'ciss/a' }]));
    expect(result.proposals).toEqual([]);
    expect(result.unmatched.map(({ reason }) => reason)).toEqual(['identity_not_found', 'missing_exact_identity', 'missing_exact_identity', 'identity_not_found']);
  });

  it('blocks ambiguous employee IDs instead of taking the first match', () => {
    const result = report(fixture([employee('a', { employeeId: 'CISS/shared' }), employee('b', { employeeId: 'CISS/shared' })], [{ employeeId: 'CISS/shared' }]));
    expect(result.proposals).toEqual([]);
    expect(result.ambiguous).toEqual([expect.objectContaining({ reason: 'ambiguous_employee_identity', candidateEmployeeDocIds: ['a', 'b'] })]);
  });

  it('requires both supplied identities to agree and blocks later proposals for the conflicting employee', () => {
    const result = report(fixture([employee('a'), employee('b')], [{ employeeDocId: 'a', employeeId: 'CISS/b' }, { employeeDocId: 'a' }], [{ employeeDocId: 'b' }]));
    expect(result.proposals).toEqual([]);
    expect(result.conflicting).toEqual([expect.objectContaining({ reason: 'conflicting_identity', candidateEmployeeDocIds: ['a', 'b'] })]);
  });

  it('does not accept a matched ID when a second supplied ID is unknown', () => {
    const result = report(fixture([employee('a')], [{ employeeDocId: 'a', employeeId: 'CISS/missing' }]));
    expect(result.proposals).toEqual([]);
    expect(result.conflicting[0].reason).toBe('conflicting_identity');
  });

  it('reports duplicate source identities and blocks that employee across both lists', () => {
    const result = report(fixture([employee('a')], [{ employeeDocId: 'a' }, { employeeId: 'CISS/a' }], [{ employeeDocId: 'a' }]));
    expect(result.proposals).toEqual([]);
    expect(result.ambiguous).toEqual([expect.objectContaining({ reason: 'duplicate_source_identity', source: 'biometric', recordIndexes: [0, 1], candidateEmployeeDocIds: ['a'] })]);
  });

  it('reports duplicate unmatched source identities for source cleanup', () => {
    const result = report(fixture([], [{ employeeDocId: 'missing' }, { employeeDocId: 'missing' }]));
    expect(result.unmatched).toHaveLength(2);
    expect(result.ambiguous).toEqual([expect.objectContaining({ reason: 'duplicate_source_identity', source: 'biometric', recordIndexes: [0, 1], candidateEmployeeDocIds: [] })]);
  });

  it('reports non-TCS matches without proposing a category', () => {
    const result = report(fixture([employee('a', { clientName: 'LNG' })], [{ employeeDocId: 'a' }]));
    expect(result.proposals).toEqual([]);
    expect(result.conflicting[0]).toMatchObject({ employeeDocId: 'a', reason: 'non_tcs_employee' });
  });

  it('writes stable JSON and CSV reports with quotes, commas, newlines and spreadsheet formulas escaped', () => {
    const data = fixture([employee('=a', { employeeId: 'CISS/"a",\nline' })], [{ employeeDocId: '=a', reference: 'row "1",\nnext' }]);
    const json = join(data.folder, 'report.json');
    const csv = join(data.folder, 'report.csv');
    const first = run(data, ['--json-out', json, '--csv-out', csv]);
    expect(first.status, first.stderr).toBe(0);
    expect(JSON.parse(readFileSync(json, 'utf8'))).toEqual(JSON.parse(first.stdout));
    const text = readFileSync(csv, 'utf8');
    expect(text).toContain('"\'=a"');
    expect(text).toContain('"CISS/""a"",\nline"');
    expect(text).toContain('proposed');
    expect(run(data).stdout).toBe(first.stdout);
  });

  it.each(['--apply', '--apply=true'])('rejects %s before reading inputs', (flag) => {
    const result = spawnSync(process.execPath, [script, flag], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/offline.only.*apply/i);
  });

  it('requires all three explicit local inputs', () => {
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/required.*--employees.*--biometric.*--permanent/i);
  });

  it.each([
    ['missing source provenance', (data) => { const body = JSON.parse(readFileSync(data.paths.biometric, 'utf8')); delete body.source.provenance; writeFileSync(data.paths.biometric, JSON.stringify(body)); }],
    ['impossible source date', (data) => { const body = JSON.parse(readFileSync(data.paths.biometric, 'utf8')); body.source.date = '2026-02-30'; writeFileSync(data.paths.biometric, JSON.stringify(body)); }],
    ['non-string identifier', (data) => { const body = JSON.parse(readFileSync(data.paths.biometric, 'utf8')); body.records = [{ employeeDocId: 4 }]; writeFileSync(data.paths.biometric, JSON.stringify(body)); }],
    ['duplicate export document ID', (data) => { const body = JSON.parse(readFileSync(data.paths.employees, 'utf8')); body.employees.push(employee('a')); writeFileSync(data.paths.employees, JSON.stringify(body)); }],
    ['malformed JSON', (data) => writeFileSync(data.paths.biometric, '{')],
    ['non-array records', (data) => { const body = JSON.parse(readFileSync(data.paths.biometric, 'utf8')); body.records = {}; writeFileSync(data.paths.biometric, JSON.stringify(body)); }],
  ])('rejects malformed input: %s', (_label, change) => {
    const data = fixture([employee('a')]);
    change(data);
    const result = run(data);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/invalid/i);
  });

  it.each(['direct', 'symlink', 'hardlink'])('cannot overwrite inputs through a %s output path', (kind) => {
    const data = fixture([employee('a')], [{ employeeDocId: 'a' }]);
    const original = readFileSync(data.paths.employees, 'utf8');
    let output = data.paths.employees;
    if (kind !== 'direct') {
      output = join(data.folder, `${kind}.json`);
      if (kind === 'symlink') symlinkSync(data.paths.employees, output);
      else linkSync(data.paths.employees, output);
    }
    const result = run(data, ['--json-out', output]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/overwrite|already exists/i);
    expect(readFileSync(data.paths.employees, 'utf8')).toBe(original);
  });

  it('rejects output collisions before creating either output', () => {
    const data = fixture([employee('a')]);
    const output = join(data.folder, 'same.json');
    const result = run(data, ['--json-out', output, '--csv-out', output]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/distinct/i);
    expect(() => readFileSync(output)).toThrow();
  });

  it('rejects case-only output aliases before creating either report and leaves all inputs untouched', () => {
    const data = fixture([employee('a')], [{ employeeDocId: 'a' }]);
    const originals = Object.values(data.paths).map((path) => readFileSync(path, 'utf8'));
    const json = join(data.folder, 'report.json');
    const csv = join(data.folder, 'REPORT.JSON');
    const result = run(data, ['--json-out', json, '--csv-out', csv]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(existsSync(json)).toBe(false);
    expect(existsSync(csv)).toBe(false);
    expect(result.stderr).toMatch(/distinct/i);
    expect(Object.values(data.paths).map((path) => readFileSync(path, 'utf8'))).toEqual(originals);
  });
});
