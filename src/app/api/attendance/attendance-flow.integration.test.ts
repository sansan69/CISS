import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildShiftTemplates } from "@/lib/shift-utils";

type Filter = {
  field: string;
  op: "==" | ">=" | "<=" | "in" | "array-contains";
  value: unknown;
};

const deleteSentinel = { __op: "delete" } as const;

class FakeTimestamp {
  constructor(private readonly date: Date) {}

  toDate() {
    return new Date(this.date);
  }

  get seconds() {
    return Math.floor(this.date.getTime() / 1000);
  }

  get nanoseconds() {
    return (this.date.getTime() % 1000) * 1_000_000;
  }
}

class FakeDocSnapshot {
  constructor(
    readonly id: string,
    private readonly dataValue: Record<string, unknown> | undefined,
  ) {}

  get exists() {
    return Boolean(this.dataValue);
  }

  data() {
    return this.dataValue;
  }
}

class FakeDocRef {
  constructor(
    private readonly store: FakeFirestore,
    readonly collectionName: string,
    readonly id: string,
  ) {}

  async get() {
    return new FakeDocSnapshot(this.id, this.store.getDoc(this.collectionName, this.id));
  }

  async set(value: Record<string, unknown>, options?: { merge?: boolean }) {
    this.store.setDoc(this.collectionName, this.id, value, options);
  }

  async update(value: Record<string, unknown>) {
    this.store.updateDoc(this.collectionName, this.id, value);
  }
}

class FakeQuerySnapshot {
  constructor(
    readonly docs: Array<{ id: string; data: () => Record<string, unknown>; ref: FakeDocRef }>,
  ) {}

  get empty() {
    return this.docs.length === 0;
  }

  get size() {
    return this.docs.length;
  }
}

class FakeQuery {
  constructor(
    protected readonly store: FakeFirestore,
    protected readonly collectionName: string,
    protected readonly filters: Filter[] = [],
    protected readonly orderByField: string | null = null,
    protected readonly orderByDirection: "asc" | "desc" = "asc",
    protected readonly limitCount: number | null = null,
  ) {}

  where(field: string, op: Filter["op"], value: unknown) {
    return new FakeQuery(
      this.store,
      this.collectionName,
      [...this.filters, { field, op, value }],
      this.orderByField,
      this.orderByDirection,
      this.limitCount,
    );
  }

  orderBy(field: string, direction: "asc" | "desc" = "asc") {
    return new FakeQuery(
      this.store,
      this.collectionName,
      this.filters,
      field,
      direction,
      this.limitCount,
    );
  }

  limit(value: number) {
    return new FakeQuery(
      this.store,
      this.collectionName,
      this.filters,
      this.orderByField,
      this.orderByDirection,
      value,
    );
  }

  async get() {
    let docs = this.store
      .listDocs(this.collectionName)
      .filter(({ data }) => this.filters.every((filter) => matchesFilter(data, filter)));

    if (this.orderByField) {
      docs = [...docs].sort((left, right) => {
        const leftValue = toMillis(left.data[this.orderByField!]);
        const rightValue = toMillis(right.data[this.orderByField!]);
        return this.orderByDirection === "desc" ? rightValue - leftValue : leftValue - rightValue;
      });
    }

    const limited = typeof this.limitCount === "number" ? docs.slice(0, this.limitCount) : docs;
    return new FakeQuerySnapshot(
      limited.map(({ id, data }) => ({
        id,
        data: () => data,
        ref: new FakeDocRef(this.store, this.collectionName, id),
      })),
    );
  }
}

class FakeCollectionRef extends FakeQuery {
  doc(id?: string) {
    return new FakeDocRef(this.store, this.collectionName, id ?? this.store.nextId(this.collectionName));
  }
}

class FakeTransaction {
  constructor(private readonly store: FakeFirestore) {}

  async get(ref: FakeDocRef) {
    return ref.get();
  }

  set(ref: FakeDocRef, value: Record<string, unknown>, options?: { merge?: boolean }) {
    this.store.setDoc(ref.collectionName, ref.id, value, options);
  }

  update(ref: FakeDocRef, value: Record<string, unknown>) {
    this.store.updateDoc(ref.collectionName, ref.id, value);
  }
}

class FakeFirestore {
  private readonly collections = new Map<string, Map<string, Record<string, unknown>>>();

  collection(name: string) {
    return new FakeCollectionRef(this, name);
  }

  doc(path: string) {
    const [collectionName, id] = path.split("/");
    if (!collectionName || !id) {
      throw new Error(`Unsupported document path: ${path}`);
    }

    return new FakeDocRef(this, collectionName, id);
  }

  async runTransaction<T>(fn: (transaction: FakeTransaction) => Promise<T>) {
    return fn(new FakeTransaction(this));
  }

  async getAll(...refs: FakeDocRef[]) {
    return Promise.all(refs.map((ref) => ref.get()));
  }

  seed(collectionName: string, id: string, value: Record<string, unknown>) {
    this.setDoc(collectionName, id, value);
  }

  nextId(collectionName: string) {
    return `${collectionName}-${this.listDocs(collectionName).length + 1}`;
  }

  getDoc(collectionName: string, id: string) {
    return this.collections.get(collectionName)?.get(id);
  }

  listDocs(collectionName: string) {
    return Array.from(this.collections.get(collectionName)?.entries() ?? []).map(([id, data]) => ({
      id,
      data,
    }));
  }

  setDoc(
    collectionName: string,
    id: string,
    value: Record<string, unknown>,
    options?: { merge?: boolean },
  ) {
    if (!this.collections.has(collectionName)) {
      this.collections.set(collectionName, new Map());
    }

    const existing = options?.merge ? this.collections.get(collectionName)?.get(id) ?? {} : {};
    this.collections.get(collectionName)!.set(id, applyTransforms({ ...existing }, value));
  }

  updateDoc(collectionName: string, id: string, value: Record<string, unknown>) {
    const existing = this.getDoc(collectionName, id);
    if (!existing) {
      throw new Error(`Document ${collectionName}/${id} does not exist.`);
    }

    this.setDoc(collectionName, id, { ...existing, ...value });
  }
}

function applyTransforms(current: Record<string, unknown>, update: Record<string, unknown>) {
  const next = { ...current };
  for (const [key, value] of Object.entries(update)) {
    if (value === deleteSentinel) {
      delete next[key];
      continue;
    }
    next[key] = normalizeValue(value);
  }
  return next;
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) {
    return new FakeTimestamp(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }
  if (value && typeof value === "object") {
    if (typeof (value as { toDate?: unknown }).toDate === "function") {
      return value;
    }
    const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      normalizeValue(item),
    ]);
    return Object.fromEntries(entries);
  }
  return value;
}

function toMillis(value: unknown) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function matchesFilter(data: Record<string, unknown>, filter: Filter) {
  const actual = data[filter.field];

  if (filter.op === "==") {
    return actual === filter.value;
  }

  if (filter.op === "in") {
    return Array.isArray(filter.value) ? filter.value.includes(actual) : false;
  }

  if (filter.op === "array-contains") {
    return Array.isArray(actual) ? actual.includes(filter.value) : false;
  }

  const actualMillis = toMillis(actual);
  const filterMillis = toMillis(filter.value);

  if (filter.op === ">=") {
    return actualMillis >= filterMillis;
  }

  if (filter.op === "<=") {
    return actualMillis <= filterMillis;
  }

  return false;
}

function makeResponseToken(role: "guard" | "fieldOfficer" | "admin" | "client"): any {
  const base = {
    uid: `${role}-uid`,
    role,
    email: `${role}@example.com`,
  };

  if (role === "guard") {
    return {
      ...base,
      employeeId: "CISS/ACME/2026-27/001",
      employeeDocId: "emp-1",
    };
  }

  if (role === "fieldOfficer") {
    return {
      ...base,
      assignedDistricts: ["Ernakulam"],
    };
  }

  if (role === "client") {
    return {
      ...base,
      clientName: "Acme Security",
      clientId: "client-1",
    };
  }

  return base;
}

function decodeTokenFromRequest(request: Request) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  if (token === "guard") return makeResponseToken("guard");
  if (token.startsWith("guard:")) {
    const employeeDocId = token.slice("guard:".length).trim() || "emp-1";
    return {
      ...makeResponseToken("guard"),
      employeeDocId,
    };
  }
  if (token === "fieldOfficer") return makeResponseToken("fieldOfficer");
  if (token === "admin") return makeResponseToken("admin");
  if (token === "client") return makeResponseToken("client");
  return null;
}

function buildAttendancePayload(args: {
  employeeDocId: string;
  employeeId: string;
  employeeName: string;
  employeePhoneNumber: string;
  clientName: string;
  siteClientName?: string;
  district: string;
  siteId: string;
  siteName: string;
  siteCoords: { lat: number; lng: number };
  locationCoords: { lat: number; lon: number; accuracyMeters?: number };
  locationText: string;
  status: "In" | "Out";
  reportedAtClient: string;
  shiftCode?: string;
  shiftLabel?: string;
  shiftStartTime?: string;
  shiftEndTime?: string;
  nextShiftCode?: string;
  nextShiftStartsAt?: string;
}) {
  return {
    employeeId: args.employeeId,
    employeeName: args.employeeName,
    employeeDocId: args.employeeDocId,
    reportedAtClient: args.reportedAtClient,
    employeePhoneNumber: args.employeePhoneNumber,
    employeeClientName: args.clientName,
    status: args.status,
    district: args.district,
    siteId: args.siteId,
    siteName: args.siteName,
    dutyPointId: "main-duty",
    dutyPointName: "Main Duty",
    clientName: args.siteClientName ?? args.clientName,
    shiftCode: args.shiftCode,
    shiftLabel: args.shiftLabel,
    shiftStartTime: args.shiftStartTime,
    shiftEndTime: args.shiftEndTime,
    nextShiftCode: args.nextShiftCode,
    nextShiftStartsAt: args.nextShiftStartsAt,
    siteCoords: args.siteCoords,
    locationText: args.locationText,
    locationCoords: args.locationCoords,
    distanceMeters: 12,
    gpsAccuracyMeters: 8,
    locationAccuracyMeters: 8,
    geofenceRadiusAtTime: 200,
    sourceCollection: "sites" as const,
    photoUrl: "https://example.com/photo.jpg",
    photoCapturedAt: args.reportedAtClient,
    deviceInfo: { userAgent: "vitest" },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.doUnmock("@/lib/firebaseAdmin");
  vi.doUnmock("@/lib/server/auth");
  vi.doUnmock("@/lib/server/guard-auth");
  vi.doUnmock("@/lib/server/audit");
  vi.doUnmock("@/lib/server/monitoring");
  vi.doUnmock("@/lib/work-orders/assignment-match");
  vi.doUnmock("firebase-admin/firestore");
});

describe("attendance flow integration", () => {
  it("writes and reads a 12-hour overnight attendance cycle consistently", async () => {
    vi.useFakeTimers();
    const db = new FakeFirestore();

    db.seed("employees", "emp-1", {
      employeeId: "CISS/ACME/2026-27/001",
      fullName: "Dummy Guard One",
      phoneNumber: "9999999999",
      clientName: "Acme Security",
      district: "Ernakulam",
      status: "Active",
      guardAuthUid: "guard-uid",
    });
    db.seed("sites", "site-12h", {
      siteName: "Acme Tower",
      clientName: "Acme Security",
      clientId: "client-1",
      district: "Ernakulam",
      lat: 9.981,
      lng: 76.281,
      geofenceRadiusMeters: 250,
      strictGeofence: true,
      shiftMode: "fixed",
      shiftPattern: "2x12",
      shiftTemplates: buildShiftTemplates("2x12"),
      dutyPoints: [],
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    vi.doMock("@/lib/server/audit", () => ({
      buildServerAuditEvent: vi.fn((event: string, actor: unknown, payload: unknown) => ({
        event,
        actor,
        payload,
      })),
    }));
    vi.doMock("@/lib/server/monitoring", () => ({
      SYSTEM_METRIC_NAMES: {
        attendanceSubmitSuccess: "attendance_submit_success",
        attendanceSubmitFailure: "attendance_submit_failure",
      },
      incrementSystemMetric: vi.fn(async () => undefined),
    }));
    vi.doMock("@/lib/work-orders/assignment-match", () => ({
      isAssignedGuardMatch: vi.fn(() => true),
    }));
    vi.doMock("@/lib/server/auth", () => ({
      verifyRequestAuth: vi.fn(async (request: Request) => decodeTokenFromRequest(request)),
      hasAdminAccess: vi.fn((decoded: any) => decoded?.role === "admin"),
      hasFieldOfficerAccess: vi.fn((decoded: any) => decoded?.role === "fieldOfficer"),
      hasClientAccess: vi.fn((decoded: any) => decoded?.role === "client"),
      unauthorizedResponse: vi.fn((message: string, status: number) =>
        NextResponse.json({ error: message }, { status }),
      ),
      requireAdminOrFieldOfficer: vi.fn((decoded: any) => {
        if (decoded?.role !== "admin" && decoded?.role !== "fieldOfficer") {
          throw new Error("Admin or field officer access required.");
        }
      }),
      verifyRequestAuthAndClaims: vi.fn(),
    }));
    vi.doMock("@/lib/server/guard-auth", () => ({
      requireGuard: vi.fn(async (request: Request) => {
        const decoded = decodeTokenFromRequest(request);
        if (!decoded || decoded.role !== "guard") {
          throw new Error("Guard access required.");
        }
        return {
          uid: decoded.uid,
          employeeId: decoded.employeeId,
          employeeDocId: decoded.employeeDocId,
        };
      }),
    }));
    vi.doMock("firebase-admin/firestore", () => ({
      FieldValue: {
      delete: () => deleteSentinel,
      },
      Timestamp: {
        now: () => new FakeTimestamp(new Date(Date.now())),
        fromDate: (date: Date) => new FakeTimestamp(date),
      },
    }));

    const { POST } = (await import("./submit/route")) as any;
    const { GET: getGuardAttendance } = (await import("../guard/attendance/route")) as any;
    const { GET: getFieldOfficerGuardAttendance } = (await import("../field-officer/guard-attendance/route")) as any;
    const { GET: getPublicEmployee } = (await import("../public/attendance/employee/route")) as any;
    const { GET: getAdminAttendanceReport } = (await import("../admin/reports/attendance/route")) as any;

    const site = {
      id: "site-12h",
      siteId: "site-12h",
      siteName: "Acme Tower",
      clientName: "Acme Security",
      district: "Ernakulam",
      siteCoords: { lat: 9.981, lng: 76.281 },
      locationCoords: { lat: 9.9812, lon: 76.2811, accuracyMeters: 8 },
      locationText: "Acme Tower Gate",
      employeeDocId: "emp-1",
      employeeId: "CISS/ACME/2026-27/001",
      employeeName: "Dummy Guard One",
      employeePhoneNumber: "9999999999",
    };

    const inPayload = buildAttendancePayload({
      ...site,
      status: "In",
      reportedAtClient: "2026-05-20T14:35:00.000Z",
      shiftCode: "night",
      shiftLabel: "Night Shift",
      shiftStartTime: "20:00",
      shiftEndTime: "08:00",
      nextShiftCode: "day",
      nextShiftStartsAt: "08:00",
    });

    vi.setSystemTime(new Date("2026-05-20T14:36:00.000Z"));
    const inResponse = await POST(
      new Request("https://example.com/api/attendance/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer guard",
        },
        body: JSON.stringify(inPayload),
      }),
    );

    expect(inResponse.status).toBe(200);
    const inBody = await inResponse.json();
    expect(inBody).toMatchObject({ success: true });

    const outPayload = buildAttendancePayload({
      ...site,
      status: "Out",
      reportedAtClient: "2026-05-21T02:25:00.000Z",
      shiftCode: "day",
      shiftLabel: "Day Shift",
      shiftStartTime: "08:00",
      shiftEndTime: "20:00",
      nextShiftCode: "night",
      nextShiftStartsAt: "20:00",
    });

    vi.setSystemTime(new Date("2026-05-21T02:26:00.000Z"));
    const outResponse = await POST(
      new Request("https://example.com/api/attendance/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer guard",
        },
        body: JSON.stringify(outPayload),
      }),
    );

    expect(outResponse.status).toBe(200);

    const logs = db.listDocs("attendanceLogs");
    expect(logs).toHaveLength(2);
    expect(logs.map(({ data }) => data.attendanceDate)).toEqual(["2026-05-20", "2026-05-20"]);
    expect(logs.map(({ data }) => data.status)).toEqual(["In", "Out"]);
    expect(logs[0].data.shiftLabel).toBe("Night Shift");
    expect(logs[1].data.shiftLabel).toBe("Day Shift");

    const attendanceState = db.getDoc("attendanceState", "emp-1");
    expect(attendanceState).toMatchObject({
      employeeDocId: "emp-1",
      employeeName: "Dummy Guard One",
      lastAttendanceDate: "2026-05-20",
      lastStatus: "Out",
      lastSiteId: "site-12h",
      lastDutyPointId: "main-duty",
      lastShiftCode: "day",
    });
    expect(attendanceState?.openSessionId).toBeUndefined();

    const guardAttendanceResponse = await getGuardAttendance(
      new Request("https://example.com/api/guard/attendance?month=2026-05", {
        headers: { Authorization: "Bearer guard" },
      }),
    );
    expect(guardAttendanceResponse.status).toBe(200);
    const guardAttendanceBody = await guardAttendanceResponse.json();
    expect(guardAttendanceBody.presentDays).toBe(1);
    expect(guardAttendanceBody.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          date: "2026-05-20",
          status: "In",
          siteName: "Acme Tower",
          shiftLabel: "Night Shift",
        }),
        expect.objectContaining({
          date: "2026-05-20",
          status: "Out",
          siteName: "Acme Tower",
          shiftLabel: "Day Shift",
        }),
      ]),
    );

    const fieldOfficerResponse = await getFieldOfficerGuardAttendance(
      new Request("https://example.com/api/field-officer/guard-attendance?date=2026-05-20", {
        headers: { Authorization: "Bearer fieldOfficer" },
      }),
    );
    expect(fieldOfficerResponse.status).toBe(200);
    const fieldOfficerBody = await fieldOfficerResponse.json();
    expect(fieldOfficerBody.attendance).toEqual([
      expect.objectContaining({
        guardName: "Dummy Guard One",
        employeeId: "CISS/ACME/2026-27/001",
        checkIn: "20:05",
        checkOut: "07:55",
        status: "Checked out",
        shiftLabel: "Day Shift",
      }),
    ]);

    const publicEmployeeResponse = await getPublicEmployee(
      new NextRequest("https://example.com/api/public/attendance/employee?employeeId=CISS%2FACME%2F2026-27%2F001"),
    );
    expect(publicEmployeeResponse.status).toBe(200);
    const publicEmployeeBody = await publicEmployeeResponse.json();
    expect(publicEmployeeBody.employee.attendanceHint).toMatchObject({
      lastAttendanceDate: "2026-05-20",
      lastStatus: "Out",
    });

    db.seed("employees", "emp-legacy-canonical", {
      employeeId: "CISS/LEGACY/2025-26/001",
      fullName: "Canonical Guard",
      phoneNumber: "9000000001",
      clientName: "Acme Security",
      district: "Ernakulam",
      status: "Active",
    });
    db.seed("employees", "emp-legacy-renumbered", {
      employeeId: "CISS/LEGACY/2025-26/999",
      previousEmployeeIds: ["CISS/LEGACY/2025-26/001"],
      fullName: "Renumbered Guard",
      phoneNumber: "9000000002",
      clientName: "Acme Security",
      district: "Ernakulam",
      status: "Active",
    });

    const legacyQrResponse = await getPublicEmployee(
      new NextRequest(
        "https://example.com/api/public/attendance/employee?employeeId=CISS%2FLEGACY%2F2025-26%2F001&phoneNumber=9000000002",
      ),
    );
    expect(legacyQrResponse.status).toBe(200);
    const legacyQrBody = await legacyQrResponse.json();
    expect(legacyQrBody.employee).toMatchObject({
      id: "emp-legacy-renumbered",
      employeeCode: "CISS/LEGACY/2025-26/999",
      fullName: "Renumbered Guard",
    });

    const adminReportResponse = await getAdminAttendanceReport(
      new NextRequest("https://example.com/api/admin/reports/attendance?from=2026-05-20T00:00:00.000Z&to=2026-05-21T23:59:59.999Z", {
        headers: { Authorization: "Bearer admin" },
      }),
    );
    expect(adminReportResponse.status).toBe(200);
    const adminReportBody = await adminReportResponse.json();
    expect(adminReportBody.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employeeName: "Dummy Guard One",
          employeeId: "CISS/ACME/2026-27/001",
          status: "In",
          clientName: "Acme Security",
          district: "Ernakulam",
          siteName: "Acme Tower",
          dutyPointName: "Main Duty",
          attendanceDate: "2026-05-20",
        }),
        expect.objectContaining({
          employeeName: "Dummy Guard One",
          employeeId: "CISS/ACME/2026-27/001",
          status: "Out",
          clientName: "Acme Security",
          district: "Ernakulam",
          siteName: "Acme Tower",
          dutyPointName: "Main Duty",
          attendanceDate: "2026-05-20",
        }),
      ]),
    );
  });

  it("writes and reads a 3-shift night attendance cycle consistently", async () => {
    vi.useFakeTimers();
    const db = new FakeFirestore();

    db.seed("employees", "emp-2", {
      employeeId: "CISS/ACME/2026-27/002",
      fullName: "Dummy Guard Two",
      phoneNumber: "8888888888",
      clientName: "Acme Security",
      district: "Ernakulam",
      status: "Active",
      guardAuthUid: "guard-uid-2",
    });
    db.seed("sites", "site-8h", {
      siteName: "Acme Warehouse",
      clientName: "Acme Security",
      clientId: "client-1",
      district: "Ernakulam",
      lat: 9.982,
      lng: 76.282,
      geofenceRadiusMeters: 250,
      strictGeofence: true,
      shiftMode: "fixed",
      shiftPattern: "3x8",
      shiftTemplates: buildShiftTemplates("3x8"),
      dutyPoints: [],
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    vi.doMock("@/lib/server/audit", () => ({
      buildServerAuditEvent: vi.fn((event: string, actor: unknown, payload: unknown) => ({
        event,
        actor,
        payload,
      })),
    }));
    vi.doMock("@/lib/server/monitoring", () => ({
      SYSTEM_METRIC_NAMES: {
        attendanceSubmitSuccess: "attendance_submit_success",
        attendanceSubmitFailure: "attendance_submit_failure",
      },
      incrementSystemMetric: vi.fn(async () => undefined),
    }));
    vi.doMock("@/lib/work-orders/assignment-match", () => ({
      isAssignedGuardMatch: vi.fn(() => true),
    }));
    vi.doMock("@/lib/server/auth", () => ({
      verifyRequestAuth: vi.fn(async (request: Request) => decodeTokenFromRequest(request)),
      hasAdminAccess: vi.fn((decoded: any) => decoded?.role === "admin"),
      hasFieldOfficerAccess: vi.fn((decoded: any) => decoded?.role === "fieldOfficer"),
      hasClientAccess: vi.fn((decoded: any) => decoded?.role === "client"),
      unauthorizedResponse: vi.fn((message: string, status: number) =>
        NextResponse.json({ error: message }, { status }),
      ),
      requireAdminOrFieldOfficer: vi.fn((decoded: any) => {
        if (decoded?.role !== "admin" && decoded?.role !== "fieldOfficer") {
          throw new Error("Admin or field officer access required.");
        }
      }),
    }));
    vi.doMock("@/lib/server/guard-auth", () => ({
      requireGuard: vi.fn(async (request: Request) => {
        const decoded = decodeTokenFromRequest(request);
        if (!decoded || decoded.role !== "guard") {
          throw new Error("Guard access required.");
        }
        return {
          uid: decoded.uid,
          employeeId: decoded.employeeId,
          employeeDocId: decoded.employeeDocId,
        };
      }),
    }));
    vi.doMock("firebase-admin/firestore", () => ({
      FieldValue: {
        delete: () => deleteSentinel,
      },
      Timestamp: {
        now: () => new FakeTimestamp(new Date("2026-05-23T02:00:00.000Z")),
        fromDate: (date: Date) => new FakeTimestamp(date),
      },
    }));

    const { POST } = (await import("./submit/route")) as any;
    const { GET: getFieldOfficerGuardAttendance } = (await import("../field-officer/guard-attendance/route")) as any;
    const { GET: getGuardAttendance } = (await import("../guard/attendance/route")) as any;

    const site = {
      id: "site-8h",
      siteId: "site-8h",
      siteName: "Acme Warehouse",
      clientName: "Acme Security",
      district: "Ernakulam",
      siteCoords: { lat: 9.982, lng: 76.282 },
      locationCoords: { lat: 9.9822, lon: 76.2822, accuracyMeters: 7 },
      locationText: "Acme Warehouse Gate",
      employeeDocId: "emp-2",
      employeeId: "CISS/ACME/2026-27/002",
      employeeName: "Dummy Guard Two",
      employeePhoneNumber: "8888888888",
    };

    vi.setSystemTime(new Date("2026-05-20T16:41:00.000Z"));
    const inResponse = await POST(
      new Request("https://example.com/api/attendance/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildAttendancePayload({
            ...site,
            status: "In",
            reportedAtClient: "2026-05-20T16:40:00.000Z",
            shiftCode: "night",
            shiftLabel: "Night Shift",
            shiftStartTime: "22:00",
            shiftEndTime: "06:00",
            nextShiftCode: "morning",
            nextShiftStartsAt: "06:00",
          }),
        ),
      }),
    );
    expect(inResponse.status).toBe(200);

    vi.setSystemTime(new Date("2026-05-21T00:21:00.000Z"));
    const outResponse = await POST(
      new Request("https://example.com/api/attendance/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildAttendancePayload({
            ...site,
            status: "Out",
            reportedAtClient: "2026-05-21T00:20:00.000Z",
            shiftCode: "morning",
            shiftLabel: "Morning Shift",
            shiftStartTime: "06:00",
            shiftEndTime: "14:00",
            nextShiftCode: "evening",
            nextShiftStartsAt: "14:00",
          }),
        ),
      }),
    );
    expect(outResponse.status).toBe(200);

    const logs = db.listDocs("attendanceLogs");
    expect(logs).toHaveLength(2);
    expect(logs.map(({ data }) => data.attendanceDate)).toEqual(["2026-05-20", "2026-05-20"]);
    expect(logs.map(({ data }) => data.shiftLabel)).toEqual(["Night Shift", "Morning Shift"]);

    const fieldOfficerResponse = await getFieldOfficerGuardAttendance(
      new Request("https://example.com/api/field-officer/guard-attendance?date=2026-05-20", {
        headers: { Authorization: "Bearer fieldOfficer" },
      }),
    );
    expect(fieldOfficerResponse.status).toBe(200);
    const fieldOfficerBody = await fieldOfficerResponse.json();
    expect(fieldOfficerBody.attendance).toEqual([
      expect.objectContaining({
        guardName: "Dummy Guard Two",
        checkIn: "22:10",
        checkOut: "05:50",
        shiftLabel: "Morning Shift",
        status: "Checked out",
      }),
    ]);

    const guardAttendanceResponse = await getGuardAttendance(
      new Request("https://example.com/api/guard/attendance?month=2026-05", {
        headers: { Authorization: "Bearer guard:emp-2" },
      }),
    );
    expect(guardAttendanceResponse.status).toBe(200);
    const guardAttendanceBody = await guardAttendanceResponse.json();
    expect(guardAttendanceBody.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          date: "2026-05-20",
          status: "In",
          shiftLabel: "Night Shift",
        }),
        expect.objectContaining({
          date: "2026-05-20",
          status: "Out",
          shiftLabel: "Morning Shift",
        }),
      ]),
    );
  });

  it("accepts harmless client-name punctuation differences for attendance matching", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T13:25:00.000Z"));
    const db = new FakeFirestore();

    db.seed("employees", "emp-geodis", {
      employeeId: "CISS/GEODIS/2026-27/001",
      fullName: "Muhammed Shibili",
      phoneNumber: "7777777777",
      clientName: "Geodis India Ltd Kochi",
      district: "Ernakulam",
      status: "Active",
    });
    db.seed("sites", "site-geodis-floor-9", {
      siteName: "Floor 9",
      clientName: "Geodis India Ltd., Kochi",
      district: "Ernakulam",
      lat: 9.981,
      lng: 76.281,
      geofenceRadiusMeters: 250,
      strictGeofence: true,
      shiftMode: "fixed",
      shiftPattern: "2x12",
      shiftTemplates: buildShiftTemplates("2x12"),
      dutyPoints: [],
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    vi.doMock("@/lib/server/audit", () => ({
      buildServerAuditEvent: vi.fn((event: string, actor: unknown, payload: unknown) => ({
        event,
        actor,
        payload,
      })),
    }));
    vi.doMock("@/lib/server/monitoring", () => ({
      SYSTEM_METRIC_NAMES: {
        attendanceSubmitSuccess: "attendance_submit_success",
        attendanceSubmitFailure: "attendance_submit_failure",
      },
      incrementSystemMetric: vi.fn(async () => undefined),
    }));
    vi.doMock("@/lib/work-orders/assignment-match", () => ({
      isAssignedGuardMatch: vi.fn(() => true),
    }));
    vi.doMock("firebase-admin/firestore", () => ({
      FieldValue: {
        delete: () => deleteSentinel,
      },
      Timestamp: {
        now: () => new FakeTimestamp(new Date(Date.now())),
        fromDate: (date: Date) => new FakeTimestamp(date),
      },
    }));

    const { POST } = (await import("./submit/route")) as any;

    const response = await POST(
      new Request("https://example.com/api/attendance/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildAttendancePayload({
            employeeDocId: "emp-geodis",
            employeeId: "CISS/GEODIS/2026-27/001",
            employeeName: "Muhammed Shibili",
            employeePhoneNumber: "7777777777",
            clientName: "Geodis India Ltd Kochi",
            district: "Ernakulam",
            siteId: "site-geodis-floor-9",
            siteName: "Floor 9",
            siteCoords: { lat: 9.981, lng: 76.281 },
            locationCoords: { lat: 9.9811, lon: 76.2811, accuracyMeters: 8 },
            locationText: "Geodis Floor 9",
            status: "In",
            reportedAtClient: "2026-05-23T13:24:00.000Z",
            shiftCode: "day",
            shiftLabel: "Day Shift",
            shiftStartTime: "08:00",
            shiftEndTime: "20:00",
          }),
        ),
      }),
    );

    expect(response.status).toBe(200);
    expect(db.listDocs("attendanceLogs")[0].data).toMatchObject({
      employeeId: "CISS/GEODIS/2026-27/001",
      clientName: "Geodis India Ltd., Kochi",
      siteName: "Floor 9",
      shiftLabel: "Day Shift",
      status: "In",
    });
  });

  it("records cross-client relieving duty without rejecting the selected site", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T03:30:00.000Z"));
    const db = new FakeFirestore();

    db.seed("employees", "emp-geodis-relief", {
      employeeId: "CISS/GIL/2026-27/777",
      fullName: "Relief Guard",
      phoneNumber: "7777777777",
      clientName: "Geodis India Ltd.",
      district: "Ernakulam",
      status: "Active",
    });
    db.seed("sites", "site-federal-relief", {
      siteName: "Federal Relief Center",
      clientName: "Federal Bank Ltd.",
      district: "Ernakulam",
      lat: 9.981,
      lng: 76.281,
      geofenceRadiusMeters: 250,
      strictGeofence: true,
      shiftMode: "fixed",
      shiftPattern: "2x12",
      shiftTemplates: buildShiftTemplates("2x12"),
      dutyPoints: [],
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    vi.doMock("@/lib/server/audit", () => ({
      buildServerAuditEvent: vi.fn((event: string, actor: unknown, payload: unknown) => ({
        event,
        actor,
        payload,
      })),
    }));
    vi.doMock("@/lib/server/monitoring", () => ({
      SYSTEM_METRIC_NAMES: {
        attendanceSubmitSuccess: "attendance_submit_success",
        attendanceSubmitFailure: "attendance_submit_failure",
      },
      incrementSystemMetric: vi.fn(async () => undefined),
    }));
    vi.doMock("@/lib/work-orders/assignment-match", () => ({
      isAssignedGuardMatch: vi.fn(() => true),
    }));
    vi.doMock("firebase-admin/firestore", () => ({
      FieldValue: {
        delete: () => deleteSentinel,
      },
      Timestamp: {
        now: () => new FakeTimestamp(new Date(Date.now())),
        fromDate: (date: Date) => new FakeTimestamp(date),
      },
    }));

    const { POST } = (await import("./submit/route")) as any;

    const response = await POST(
      new Request("https://example.com/api/attendance/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildAttendancePayload({
            employeeDocId: "emp-geodis-relief",
            employeeId: "CISS/GIL/2026-27/777",
            employeeName: "Relief Guard",
            employeePhoneNumber: "7777777777",
            clientName: "Geodis India Ltd.",
            siteClientName: "Federal Bank Ltd.",
            district: "Ernakulam",
            siteId: "site-federal-relief",
            siteName: "Federal Relief Center",
            siteCoords: { lat: 9.981, lng: 76.281 },
            locationCoords: { lat: 9.9811, lon: 76.2811, accuracyMeters: 8 },
            locationText: "Federal Relief Center",
            status: "In",
            reportedAtClient: "2026-05-24T03:29:00.000Z",
            shiftCode: "day",
            shiftLabel: "Day Shift",
            shiftStartTime: "08:00",
            shiftEndTime: "20:00",
          }),
        ),
      }),
    );

    expect(response.status).toBe(200);
    expect(db.listDocs("attendanceLogs")[0].data).toMatchObject({
      employeeId: "CISS/GIL/2026-27/777",
      employeeClientName: "Geodis India Ltd.",
      siteClientName: "Federal Bank Ltd.",
      clientName: "Federal Bank Ltd.",
      crossClientRelief: true,
      siteName: "Federal Relief Center",
      status: "In",
    });
    expect(db.listDocs("attendanceSessions")[0].data).toMatchObject({
      employeeClientName: "Geodis India Ltd.",
      siteClientName: "Federal Bank Ltd.",
      clientName: "Federal Bank Ltd.",
      crossClientRelief: true,
    });
  });
});
