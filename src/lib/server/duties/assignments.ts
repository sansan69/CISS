import { db } from '@/lib/firebaseAdmin';
import type { GuardAssignmentDto } from '@/types/duties';
import { resolveDutySupervisor, recheckSupervisor, assertDistrict, assertEmployee, employeeDistrict, transactionSite, canonicalDutyDate, inputDutyDate, addDays, dateWindow, pagedQuery, resolveDutySite, text, DutySite } from './scope';
import { documentId, strictBody, requestId, version, fingerprint, receiptRef, replayReceipt, assertVersion, DutyError, invalid, hash, iso } from './requests';
import { buildDutyNotificationWrites, dispatchDutyNotifications } from './notifications';
const editable = ['siteId', 'date', 'shiftCode', 'shiftLabel', 'startTime', 'endTime', 'crossesMidnight', 'type'];
function shift(site: DutySite, b: Record<string, any>) {
  const templates = Array.isArray(site.data.shiftTemplates) ? site.data.shiftTemplates : [];
  let config: Record<string, any> = b;
  if (templates.length) {
    config = templates.find(t => t.code === b.shiftCode);
    if (!config)
      invalid('Select a configured site shift.');
    config = {
      ...config,
      shiftLabel: config.shiftLabel ?? config.label
    };
    if (['shiftLabel', 'startTime', 'endTime', 'crossesMidnight'].some(k => b[k] !== undefined && b[k] !== config[k]))
      invalid('Shift details must match the configured site template.');
  }
  else if (b.shiftCode)
    invalid('Site has no configured shift code.');
  if (typeof config.shiftLabel !== 'string' && typeof config.label === 'string')
    config = {
      ...config,
      shiftLabel: config.label
    };
  const label = text(config.shiftLabel);
  const start = text(config.startTime);
  const end = text(config.endTime);
  if (!label || label.length > 120 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || (config.crossesMidnight !== undefined && typeof config.crossesMidnight !== 'boolean'))
    invalid('An explicit label and valid start/end times are required.');
  const overnight = config.crossesMidnight ?? false;
  if (overnight ? end > start : end <= start)
    invalid('Shift end must follow start; set crossesMidnight for an overnight shift.');
  const date = inputDutyDate(b.date);
  return {
    shiftCode: templates.length ? text(config.code) : null,
    shiftLabel: label,
    startTime: start,
    endTime: end,
    crossesMidnight: overnight,
    startsAt: new Date(`${date}T${start}:00+05:30`).toISOString(),
    endsAt: new Date(`${overnight ? addDays(date, 1) : date}T${end}:00+05:30`).toISOString()
  };
}
export function assignmentDto(id: string, data: Record<string, any>): GuardAssignmentDto {
  return {
    id,
    guardId: text(data.guardId),
    guardUid: text(data.guardUid),
    employeeId: text(data.employeeId),
    guardName: text(data.guardName),
    district: text(data.district),
    clientName: text(data.clientName),
    siteId: text(data.siteId),
    siteName: text(data.siteName),
    date: text(data.date),
    shiftCode: data.shiftCode ?? null,
    shiftLabel: text(data.shiftLabel),
    startsAt: iso(data.startsAt)!,
    endsAt: iso(data.endsAt)!,
    type: data.type,
    status: data.status,
    version: Number(data.version),
    assignedBy: text(data.assignedBy),
    assignedAt: iso(data.assignedAt)!,
    updatedBy: text(data.updatedBy),
    updatedAt: iso(data.updatedAt)!
  };
}
function slotKey(data: Record<string, any>) {
  return hash([data.guardId, data.siteId, data.date, data.startsAt, data.endsAt]);
}
export async function createGuardAssignment(request: Request, input: unknown) {
  const b = strictBody(input, ['employeeDocId', ...editable, 'clientRequestId']);
  documentId(b.employeeDocId);
  documentId(b.siteId);
  inputDutyDate(b.date);
  requestId(b.clientRequestId);
  if (!['regular', 'relieving'].includes(b.type))
    invalid('type must be regular or relieving.');
  const supervisor = await resolveDutySupervisor(request);
  const fp = fingerprint(b);
  const receipt = receiptRef(db, 'assignment_create', supervisor.uid, 'create', b.clientRequestId);
  const id = hash(['assignment', supervisor.uid, b.clientRequestId]);
  const result = await db.runTransaction(async (tx) => {
    const currentSupervisor = await recheckSupervisor(tx, supervisor);
    const employeeSnap = await tx.get(db.collection('employees').doc(b.employeeDocId));
    if (!employeeSnap.exists)
      throw new DutyError(404, 'employee_not_found', 'Guard not found.');
    const employee = employeeSnap.data()!;
    assertEmployee(employee);
    assertDistrict(currentSupervisor, employeeDistrict(employee));
    const site = await transactionSite(tx, b.siteId);
    assertDistrict(currentSupervisor, site.district);
    const priorReceipt = replayReceipt(await tx.get(receipt), fp);
    if (priorReceipt)
      return {
        ...priorReceipt.result,
        replayed: true,
        eventIds: priorReceipt.eventIds ?? []
      };
    const now = new Date();
    const next = {
      guardId: b.employeeDocId,
      guardUid: text(employee.guardAuthUid),
      employeeId: text(employee.employeeId),
      guardName: text(employee.fullName || employee.name) || 'Guard',
      district: site.district,
      clientName: site.clientName,
      siteId: site.id,
      siteName: site.siteName,
      date: canonicalDutyDate(b.date),
      ...shift(site, b),
      type: b.type,
      status: 'assigned',
      version: 1,
      assignedBy: supervisor.uid,
      assignedAt: now,
      updatedBy: supervisor.uid,
      updatedAt: now
    };
    const key = slotKey(next);
    const slot = db.collection('guardAssignmentSlots').doc(key);
    if ((await tx.get(slot)).data()?.assignmentId)
      throw new DutyError(409, 'duplicate_assignment', 'This guard already has that active site/date/shift assignment.');
    const writes = buildDutyNotificationWrites({
      operation: 'assignment',
      entityId: id,
      version: 1,
      type: 'duty_assigned',
      recipientUid: next.guardUid,
      recipientRole: 'guard',
      district: site.district,
      title: 'Duty assigned',
      body: 'Open Duties to view your assignment.',
      data: {
        assignmentId: id,
        routeKind: 'guard_duties'
      }
    });
    const outcome = {
      success: true,
      assignment: assignmentDto(id, next),
      replayed: false
    };
    tx.create(db.collection('guardAssignments').doc(id), {
      ...next,
      slotKey: key
    });
    tx.set(slot, {
      assignmentId: id
    });
    for (const w of writes)
      tx.create(w.ref, w.data);
    tx.create(receipt, {
      fingerprint: fp,
      result: outcome,
      eventIds: writes.map(w => w.ref.id),
      createdAt: now
    });
    return {
      ...outcome,
      eventIds: writes.map(w => w.ref.id)
    };
  });
  await dispatchDutyNotifications(result.eventIds);
  const { eventIds, ...outcome } = result;
  void eventIds;
  return outcome;
}
export async function updateGuardAssignment(request: Request, id: string, input: unknown) {
  documentId(id);
  const b = strictBody(input, [...editable, 'status', 'expectedVersion', 'clientRequestId']);
  requestId(b.clientRequestId);
  version(b.expectedVersion);
  if (b.siteId !== undefined)
    documentId(b.siteId);
  if (b.status !== undefined && b.status !== 'cancelled')
    invalid('Only cancellation status is supported.');
  if (!Object.keys(b).some(k => editable.includes(k) || k === 'status'))
    invalid('No changes supplied.');
  const supervisor = await resolveDutySupervisor(request);
  const receipt = receiptRef(db, 'assignment_update', supervisor.uid, id, b.clientRequestId);
  const fp = fingerprint(b);
  const result = await db.runTransaction(async (tx) => {
    const s = await recheckSupervisor(tx, supervisor);
    const ref = db.collection('guardAssignments').doc(id);
    const snap = await tx.get(ref);
    if (!snap.exists)
      throw new DutyError(404, 'assignment_not_found', 'Assignment not found.');
    const old = snap.data()!;
    const employeeSnap = await tx.get(db.collection('employees').doc(documentId(old.guardId)));
    if (!employeeSnap.exists)
      throw new DutyError(404, 'employee_not_found', 'Guard not found.');
    const employee = employeeSnap.data()!;
    assertEmployee(employee);
    assertDistrict(s, employeeDistrict(employee));
    const previousSite = await transactionSite(tx, old.siteId);
    assertDistrict(s, previousSite.district);
    const site = b.siteId && b.siteId !== old.siteId ? await transactionSite(tx, b.siteId) : previousSite;
    assertDistrict(s, site.district);
    const priorReceipt = replayReceipt(await tx.get(receipt), fp);
    if (priorReceipt)
      return {
        ...priorReceipt.result,
        replayed: true,
        eventIds: priorReceipt.eventIds ?? []
      };
    assertVersion(b.expectedVersion, Number(old.version), {
      assignment: assignmentDto(id, old)
    });
    if (old.status === 'cancelled' && b.status !== 'cancelled')
      throw new DutyError(409, 'assignment_cancelled', 'Assignment has been cancelled.');
    const merged = {
      ...old,
      ...b
    };
    if (b.siteId && b.siteId !== old.siteId) {
      for (const k of ['shiftCode', 'shiftLabel', 'startTime', 'endTime', 'crossesMidnight'])
        if (b[k] === undefined)
          delete merged[k];
    }
    // A supplied shift code selects the configured site template. Inherited details of
    // the previous shift are dropped so the template, or explicit overrides, decide them.
    if (b.shiftCode !== undefined) {
      for (const k of ['shiftLabel', 'startTime', 'endTime', 'crossesMidnight'])
        if (b[k] === undefined)
          delete merged[k];
    }
    if (!['regular', 'relieving'].includes(merged.type))
      invalid('Invalid assignment type.');
    const next: Record<string, any> = {
      ...old,
      ...Object.fromEntries(editable.filter(k => b[k] !== undefined).map(k => [k, b[k]])),
      ...shift(site, merged),
      siteId: site.id,
      siteName: site.siteName,
      clientName: site.clientName,
      district: site.district,
      guardUid: text(employee.guardAuthUid),
      status: b.status ?? old.status
    };
    next.date = canonicalDutyDate(next.date);
    const changed = hash(assignmentDto(id, next)) !== hash(assignmentDto(id, old));
    const key = slotKey(next);
    const slot = db.collection('guardAssignmentSlots').doc(key);
    const movingSlot = key !== old.slotKey;
    const previousSlot = old.slotKey ? db.collection('guardAssignmentSlots').doc(old.slotKey) : null;
    if (next.status === 'assigned' && movingSlot) {
      const occupied = (await tx.get(slot)).data()?.assignmentId;
      if (occupied && occupied !== id)
        throw new DutyError(409, 'duplicate_assignment', 'This guard already has that active site/date/shift assignment.');
    }
    // After a cancellation and replacement the previous slot may already belong to a
    // newer assignment, so only the assignment that currently holds it may release it.
    const previousSlotOwner = previousSlot ? (await tx.get(previousSlot)).data()?.assignmentId : null;
    const ownsPreviousSlot = !!previousSlot && previousSlotOwner === id;
    if (changed) {
      next.version = Number(old.version) + 1;
      next.updatedBy = supervisor.uid;
      next.updatedAt = new Date();
    }
    const writes = changed ? buildDutyNotificationWrites({
      operation: 'assignment',
      entityId: id,
      version: next.version,
      type: next.status === 'cancelled' ? 'duty_cancelled' : 'duty_changed',
      recipientUid: next.guardUid,
      recipientRole: 'guard',
      district: site.district,
      title: next.status === 'cancelled' ? 'Duty cancelled' : 'Duty changed',
      body: 'Open Duties to view your assignment.',
      data: {
        assignmentId: id,
        routeKind: 'guard_duties'
      }
    }) : [];
    const outcome = {
      success: true,
      assignment: assignmentDto(id, next),
      replayed: false
    };
    if (changed) {
      tx.set(ref, {
        ...next,
        slotKey: key
      });
      if (ownsPreviousSlot && (next.status === 'cancelled' || movingSlot))
        tx.set(previousSlot!, {
          assignmentId: null
        });
      if (next.status === 'assigned')
        tx.set(slot, {
          assignmentId: id
        });
    }
    for (const w of writes)
      tx.create(w.ref, w.data);
    tx.create(receipt, {
      fingerprint: fp,
      result: outcome,
      eventIds: writes.map(w => w.ref.id),
      createdAt: new Date()
    });
    return {
      ...outcome,
      eventIds: writes.map(w => w.ref.id)
    };
  });
  await dispatchDutyNotifications(result.eventIds);
  const { eventIds, ...outcome } = result;
  void eventIds;
  return outcome;
}
export async function listGuardAssignments(request: Request, from?: string | null, to?: string | null) {
  const supervisor = await resolveDutySupervisor(request);
  const range = dateWindow(from, to);
  const docs = await pagedQuery(db.collection('guardAssignments').where('date', '>=', range.from).where('date', '<=', range.to).orderBy('date').orderBy('__name__'));
  const out: GuardAssignmentDto[] = [];
  for (const d of docs) {
    const row = d.data();
    try {
      const site = await resolveDutySite(db, row.siteId);
      assertDistrict(supervisor, site.district);
      const employee = (await db.collection('employees').doc(row.guardId).get()).data();
      if (!employee)
        continue;
      assertDistrict(supervisor, employeeDistrict(employee));
      out.push(assignmentDto(d.id, {
        ...row,
        siteName: site.siteName,
        clientName: site.clientName,
        district: site.district
      }));
    }
    catch (e) {
      if (e instanceof DutyError && [403, 404, 409].includes(e.status))
        continue;
      throw e;
    }
  }
  return out;
}
