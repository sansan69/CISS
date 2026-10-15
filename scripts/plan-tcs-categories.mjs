#!/usr/bin/env node
/** Offline proposal generation only. Never initializes Firebase or applies changes. */
import { readFileSync, lstatSync, realpathSync, openSync, writeFileSync, closeSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';

const help = `Offline TCS category proposals (no apply mode)
Usage: node scripts/plan-tcs-categories.mjs --employees <local.json> --biometric <local.json> --permanent <local.json> [--json-out <new.json>] [--csv-out <new.csv>]
JSON report is always printed to stdout. Output paths must be new and distinct.
See docs/tcs-category-backfill.md for input schemas and review requirements.`;

function parseOptions(args) {
  if (args.some((arg) => arg === '--apply' || arg.startsWith('--apply='))) {
    throw new Error('Offline-only tool: --apply is forbidden; no changes can be applied.');
  }
  if (args.length === 1 && args[0] === '--help') return null;
  const allowed = new Set(['--employees', '--biometric', '--permanent', '--json-out', '--csv-out']);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const option = args[i];
    if (!allowed.has(option)) throw new Error(`Invalid option: ${option}`);
    if (options[option]) throw new Error(`Invalid duplicate option: ${option}`);
    const value = args[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Invalid missing path for ${option}`);
    options[option] = resolve(value);
  }
  if (!options['--employees'] || !options['--biometric'] || !options['--permanent']) {
    throw new Error('Required local inputs: --employees, --biometric, --permanent.');
  }
  return options;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateIdentity(record, label, requireDocId = false) {
  if (!isObject(record)) throw new Error(`Invalid ${label}: expected an object.`);
  for (const key of ['employeeDocId', 'employeeId']) {
    if (Object.hasOwn(record, key) && !nonempty(record[key])) {
      throw new Error(`Invalid ${label}.${key}: expected a nonempty string.`);
    }
  }
  if (requireDocId && !nonempty(record.employeeDocId)) throw new Error(`Invalid ${label}: employeeDocId is required.`);
  if (record.employeeDocId?.includes('/')) throw new Error(`Invalid ${label}.employeeDocId: document IDs cannot contain '/'.`);
}

function loadInput(path, key, label) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`Invalid ${label}: unable to read local JSON.`);
  }
  if (!isObject(value) || !isObject(value.source) || !Array.isArray(value[key])) {
    throw new Error(`Invalid ${label}: expected source metadata and a ${key} array.`);
  }
  const { name, date, provenance } = value.source;
  if (!nonempty(name) || !nonempty(provenance) || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid ${label}.source: name, date (YYYY-MM-DD) and provenance are required.`);
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid ${label}.source.date: expected a real calendar date.`);
  }
  const docIds = new Set();
  value[key].forEach((record, index) => {
    validateIdentity(record, `${label}[${index}]`, key === 'employees');
    if (key === 'employees') {
      if (!nonempty(record.clientName)) throw new Error(`Invalid ${label}[${index}].clientName: canonical client name is required.`);
      if (docIds.has(record.employeeDocId)) throw new Error(`Invalid ${label}: duplicate employeeDocId.`);
      docIds.add(record.employeeDocId);
    }
    if (Object.hasOwn(record, 'reference') && typeof record.reference !== 'string') {
      throw new Error(`Invalid ${label}[${index}].reference: expected a string.`);
    }
  });
  return { source: { name, date, provenance }, records: value[key] };
}

function makeReport(inputs) {
  const employees = inputs.employees.records;
  const byDocId = new Map(employees.map((record) => [record.employeeDocId, record]));
  const byEmployeeId = new Map();
  for (const record of employees) {
    if (!record.employeeId) continue;
    const matches = byEmployeeId.get(record.employeeId) || [];
    matches.push(record);
    byEmployeeId.set(record.employeeId, matches);
  }
  const report = {
    schemaVersion: 1,
    mode: 'offline-proposal-only',
    sources: Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, value.source])),
    proposals: [], preserved: [], unmatched: [], ambiguous: [], conflicting: [],
    summary: {},
  };
  const evidence = new Map();
  const blocked = new Set();
  const referenced = new Set();
  for (const source of ['biometric', 'permanent']) {
    const sourceMatches = new Map();
    const unresolvedIdentities = new Map();
    inputs[source].records.forEach((record, recordIndex) => {
      const identity = Object.fromEntries(['employeeDocId', 'employeeId'].filter((key) => Object.hasOwn(record, key)).map((key) => [key, record[key]]));
      const base = { source, recordIndex, identity, reference: record.reference ?? null };
      const docMatches = record.employeeDocId ? (byDocId.has(record.employeeDocId) ? [byDocId.get(record.employeeDocId)] : []) : null;
      const idMatches = record.employeeId ? (byEmployeeId.get(record.employeeId) || []) : null;
      const candidates = [...new Set([...(docMatches || []), ...(idMatches || [])].map((item) => item.employeeDocId))].sort();
      for (const id of candidates) referenced.add(id);
      if (candidates.length === 0 && Object.keys(identity).length > 0) {
        const key = JSON.stringify(identity);
        const indexes = unresolvedIdentities.get(key) || [];
        indexes.push(recordIndex);
        unresolvedIdentities.set(key, indexes);
      }
      if (!docMatches && !idMatches) {
        report.unmatched.push({ ...base, reason: 'missing_exact_identity' });
        return;
      }
      if ((docMatches?.length || 0) > 1 || (idMatches?.length || 0) > 1) {
        candidates.forEach((id) => blocked.add(id));
        report.ambiguous.push({ ...base, reason: 'ambiguous_employee_identity', candidateEmployeeDocIds: candidates });
        return;
      }
      if (docMatches && idMatches && (docMatches.length !== 1 || idMatches.length !== 1 || docMatches[0].employeeDocId !== idMatches[0].employeeDocId)) {
        candidates.forEach((id) => blocked.add(id));
        report.conflicting.push({ ...base, reason: 'conflicting_identity', candidateEmployeeDocIds: candidates });
        return;
      }
      const match = (docMatches || idMatches)[0];
      if (!match) {
        report.unmatched.push({ ...base, reason: 'identity_not_found' });
        return;
      }
      const matches = sourceMatches.get(match.employeeDocId) || [];
      matches.push(base);
      sourceMatches.set(match.employeeDocId, matches);
      const allEvidence = evidence.get(match.employeeDocId) || [];
      allEvidence.push(base);
      evidence.set(match.employeeDocId, allEvidence);
    });
    for (const [employeeDocId, matches] of sourceMatches) {
      if (matches.length < 2) continue;
      blocked.add(employeeDocId);
      report.ambiguous.push({ source, reason: 'duplicate_source_identity', recordIndexes: matches.map((item) => item.recordIndex), candidateEmployeeDocIds: [employeeDocId] });
    }
    for (const [key, recordIndexes] of unresolvedIdentities) {
      if (recordIndexes.length < 2) continue;
      report.ambiguous.push({ source, reason: 'duplicate_source_identity', identity: JSON.parse(key), recordIndexes, candidateEmployeeDocIds: [] });
    }
  }
  for (const employeeDocId of [...evidence.keys()].sort()) {
    if (blocked.has(employeeDocId)) continue;
    const employee = byDocId.get(employeeDocId);
    const existingCategory = ['adhoc', 'permanent'].includes(employee.tcsCategory) ? employee.tcsCategory : null;
    const matches = evidence.get(employeeDocId);
    const proposedCategory = matches.some((item) => item.source === 'permanent') ? 'permanent' : 'adhoc';
    const row = { employeeDocId, employeeId: employee.employeeId ?? null, existingCategory, proposedCategory, evidence: matches };
    if (employee.clientName.trim().toUpperCase() !== 'TCS') {
      report.conflicting.push({ ...row, reason: 'non_tcs_employee' });
    } else if (existingCategory && existingCategory !== proposedCategory) {
      report.conflicting.push({ ...row, reason: 'curated_category_conflict' });
    } else if (existingCategory) {
      report.preserved.push(row);
    } else {
      report.proposals.push(row);
    }
  }
  report.summary = {
    employeeRecords: employees.length,
    biometricRecords: inputs.biometric.records.length,
    permanentRecords: inputs.permanent.records.length,
    proposals: report.proposals.length,
    preserved: report.preserved.length,
    unmatched: report.unmatched.length,
    ambiguous: report.ambiguous.length,
    conflicting: report.conflicting.length,
    blockedEmployees: blocked.size,
    unlistedEmployees: employees.length - referenced.size,
  };
  return report;
}

function csvCell(value) {
  let text = value == null ? '' : String(value);
  // A quote alone does not prevent spreadsheet formula interpretation.
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(report) {
  const columns = ['status', 'reason', 'employeeDocId', 'employeeId', 'existingCategory', 'proposedCategory', 'source', 'recordIndex', 'candidateEmployeeDocIds', 'evidence'];
  const rows = [columns];
  for (const [key, status] of [['proposals', 'proposed'], ['preserved', 'preserved'], ['unmatched', 'unmatched'], ['ambiguous', 'ambiguous'], ['conflicting', 'conflicting']]) {
    for (const row of report[key]) {
      rows.push([status, row.reason, row.employeeDocId ?? row.identity?.employeeDocId, row.employeeId ?? row.identity?.employeeId, row.existingCategory, row.proposedCategory, row.source, row.recordIndex ?? (row.recordIndexes ? JSON.stringify(row.recordIndexes) : ''), row.candidateEmployeeDocIds ? JSON.stringify(row.candidateEmployeeDocIds) : '', row.evidence ? JSON.stringify(row.evidence) : '']);
    }
  }
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function validateOutputs(options) {
  const paths = ['--json-out', '--csv-out'].filter((key) => options[key]).map((key) => options[key]);
  // Conservatively reject case-only aliases even on case-sensitive volumes.
  // This check only compares report destinations; employee IDs remain exact.
  const canonical = paths.map((path) => join(realpathSync(dirname(path)), basename(path)).toLowerCase());
  if (new Set(canonical).size !== paths.length) throw new Error('Output paths must be distinct.');
  for (const path of paths) {
    try {
      lstatSync(path);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    throw new Error('Refusing to overwrite input or output: output path already exists.');
  }
}

function writeNew(path, content) {
  const descriptor = openSync(path, 'wx', 0o600);
  try { writeFileSync(descriptor, content, 'utf8'); }
  finally { closeSync(descriptor); }
}

try {
  const options = parseOptions(process.argv.slice(2));
  if (!options) {
    process.stdout.write(`${help}\n`);
  } else {
    const inputs = {
      employees: loadInput(options['--employees'], 'employees', 'employees'),
      biometric: loadInput(options['--biometric'], 'records', 'biometric'),
      permanent: loadInput(options['--permanent'], 'records', 'permanent'),
    };
    validateOutputs(options);
    const report = makeReport(inputs);
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (options['--json-out']) writeNew(options['--json-out'], json);
    if (options['--csv-out']) writeNew(options['--csv-out'], toCsv(report));
    process.stdout.write(json);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
