import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAssignedGuardMatch } from "../lib/work-orders/assignment-match";

const patchRoutePath = resolve(
  process.cwd(),
  "src/app/api/admin/work-orders/[id]/route.ts",
);
const attendanceRoutePath = resolve(
  process.cwd(),
  "src/app/api/attendance/submit/route.ts",
);
const guardDashboardRoutePath = resolve(
  process.cwd(),
  "src/app/api/guard/dashboard/route.ts",
);

type Filter = { field: string; op: "==" | ">=" | "<="; value: unknown };

class FakeQuerySnapshot {
  constructor(
    readonly docs: Array<{ id: string; data: () => Record<string, unknown> }>,
  ) {}

  get empty() {
    return this.docs.length === 0;
  }
}

class FakeDocSnapshot {
  constructor(
    readonly id: string,
    private readonly value: Record<string, unknown> | undefined,
  ) {}

  get exists() {
    return Boolean(this.value);
  }

  data() {
    return this.value;
  }
}

class FakeDocRef {
  constructor(
    private readonly store: FakeFirestore,
    readonly collectionName: string,
    readonly id: string,
  ) {}

  async get() {
    return new FakeDocSnapshot(
      this.id,
      this.store.getDoc(this.collectionName, this.id),
    );
  }

  async set(value: Record<string, unknown>, options?: { merge?: boolean }) {
    this.store.setDoc(this.collectionName, this.id, value, options);
  }

  async update(value: Record<string, unknown>) {
    this.store.updateDoc(this.collectionName, this.id, value);
  }

  async delete() {
    this.store.deleteDoc(this.collectionName, this.id);
  }
}

class FakeQuery {
  constructor(
    protected readonly store: FakeFirestore,
    protected readonly collectionName: string,
    protected readonly filters: Filter[] = [],
    protected readonly limitCount?: number,
  ) {}

  where(field: string, op: Filter["op"], value: unknown) {
    return new FakeQuery(this.store, this.collectionName, [
      ...this.filters,
      { field, op, value },
    ], this.limitCount);
  }

  limit(value: number) {
    return new FakeQuery(this.store, this.collectionName, this.filters, value);
  }

  async get() {
    const docs = this.store
      .listDocs(this.collectionName)
      .filter(({ data }) => this.filters.every((filter) => matchFilter(data, filter)));
    const limited = typeof this.limitCount === "number" ? docs.slice(0, this.limitCount) : docs;
    return new FakeQuerySnapshot(
      limited.map(({ id, data }) => ({
        id,
        data: () => data,
      })),
    );
  }
}

class FakeCollectionRef extends FakeQuery {
  constructor(
    store: FakeFirestore,
    collectionName: string,
  ) {
    super(store, collectionName);
  }

  doc(id?: string) {
    return new FakeDocRef(
      this.store,
      this.collectionName,
      id ?? this.store.nextId(this.collectionName),
    );
  }
}

class FakeBatch {
  private readonly operations: Array<() => void> = [];

  set(ref: FakeDocRef, value: Record<string, unknown>, options?: { merge?: boolean }) {
    this.operations.push(() => {
      ref.set(value, options);
    });
  }

  update(ref: FakeDocRef, value: Record<string, unknown>) {
    this.operations.push(() => {
      ref.update(value);
    });
  }

  delete(ref: FakeDocRef) {
    this.operations.push(() => {
      ref.delete();
    });
  }

  async commit() {
    for (const operation of this.operations) {
      await operation();
    }
  }
}

class FakeFirestore {
  private readonly collections = new Map<string, Map<string, Record<string, unknown>>>();
  private idCounter = 0;

  seed(collectionName: string, id: string, value: Record<string, unknown>) {
    const nextValue =
      collectionName === "workOrders" && typeof value.clientName !== "string"
        ? { clientName: "TCS", ...value }
        : value;
    this.ensureCollection(collectionName).set(id, structuredClone(nextValue));
  }

  collection(name: string) {
    return new FakeCollectionRef(this, name);
  }

  batch() {
    return new FakeBatch();
  }

  listDocs(collectionName: string) {
    return Array.from(this.ensureCollection(collectionName).entries()).map(
      ([id, data]) => ({ id, data }),
    );
  }

  getDoc(collectionName: string, id: string) {
    return this.ensureCollection(collectionName).get(id);
  }

  setDoc(
    collectionName: string,
    id: string,
    value: Record<string, unknown>,
    options?: { merge?: boolean },
  ) {
    const collection = this.ensureCollection(collectionName);
    const current = collection.get(id);
    collection.set(
      id,
      options?.merge && current
        ? { ...current, ...structuredClone(value) }
        : structuredClone(value),
    );
  }

  updateDoc(collectionName: string, id: string, value: Record<string, unknown>) {
    const collection = this.ensureCollection(collectionName);
    const current = collection.get(id);
    if (!current) {
      throw new Error(`Document ${collectionName}/${id} does not exist.`);
    }
    collection.set(id, { ...current, ...structuredClone(value) });
  }

  deleteDoc(collectionName: string, id: string) {
    this.ensureCollection(collectionName).delete(id);
  }

  nextId(collectionName: string) {
    this.idCounter += 1;
    return `${collectionName}-${this.idCounter}`;
  }

  private ensureCollection(name: string) {
    const existing = this.collections.get(name);
    if (existing) {
      return existing;
    }
    const created = new Map<string, Record<string, unknown>>();
    this.collections.set(name, created);
    return created;
  }
}

function matchFilter(data: Record<string, unknown>, filter: Filter) {
  const actual = data[filter.field];
  switch (filter.op) {
    case "==":
      return actual === filter.value;
    case ">=":
      return compareValues(actual, filter.value) >= 0;
    case "<=":
      return compareValues(actual, filter.value) <= 0;
    default:
      return false;
  }
}

function compareValues(left: unknown, right: unknown) {
  const leftValue = normalizeComparable(left);
  const rightValue = normalizeComparable(right);
  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return 0;
}

function normalizeComparable(value: unknown) {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (value == null) {
    return "";
  }
  return String(value);
}

function makeWorkbookBuffer() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["TCS Exam"],
    ["Site Name", "District", "Male", "Female"],
    ["Alpha Site", "Ernakulam", 3, 1],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

const requireAdminMock = vi.fn();
const verifyRequestAuthMock = vi.fn();
const requireAdminOrFieldOfficerMock = vi.fn();
const unauthorizedResponseMock = vi.fn((message: string, status = 401) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  }),
);
const buildDiffMock = vi.fn();
const parseWorkbookMock = vi.fn();
const buildBinaryHashMock = vi.fn();
const buildContentHashMock = vi.fn();
const buildServerCreateAuditMock = vi.fn(() => ({ createdAt: "created-at" }));
const buildServerUpdateAuditMock = vi.fn(() => ({ updatedAt: "updated-at" }));
const buildServerAuditEventMock = vi.fn((action: string, actor: unknown, details: Record<string, unknown>) => ({
  action,
  actor,
  details,
}));
const lookupLocationGeocodeMock = vi.fn();
const buildLocationIdentityMock = vi.fn((parts: unknown[]) => parts.join("::"));

vi.mock("@/lib/server/auth", () => ({
  requireAdmin: requireAdminMock,
  verifyRequestAuth: verifyRequestAuthMock,
  requireAdminOrFieldOfficer: requireAdminOrFieldOfficerMock,
  unauthorizedResponse: unauthorizedResponseMock,
}));

vi.mock("@/lib/work-orders/tcs-exam-diff", () => ({
  buildTcsExamDiff: buildDiffMock,
}));

vi.mock("@/lib/work-orders/tcs-exam-parser", () => ({
  parseTcsExamWorkbook: parseWorkbookMock,
}));

vi.mock("@/lib/work-orders/tcs-exam-hash", () => ({
  buildBinaryFileHash: buildBinaryHashMock,
  buildTcsExamContentHash: buildContentHashMock,
}));

vi.mock("@/lib/server/audit", () => ({
  buildServerCreateAudit: buildServerCreateAuditMock,
  buildServerUpdateAudit: buildServerUpdateAuditMock,
  buildServerAuditEvent: buildServerAuditEventMock,
}));

vi.mock("@/lib/server/location-geocode", () => ({
  lookupLocationGeocode: lookupLocationGeocodeMock,
}));

vi.mock("@/lib/location-utils", () => ({
  buildLocationIdentity: buildLocationIdentityMock,
}));

vi.mock("@/lib/geo", () => ({
  haversineDistanceMeters: vi.fn(() => 0),
}));

vi.mock("@/lib/shift-utils", () => ({
  resolveSiteShift: vi.fn(() => null),
  getNextShift: vi.fn(() => null),
}));

vi.mock("@/lib/constants", () => ({
  DEFAULT_GEOFENCE_RADIUS_METERS: 150,
  DEFAULT_GPS_ACCURACY_LIMIT_METERS: 100,
  OFFLINE_ATTENDANCE_MAX_AGE_HOURS: 24,
  OPERATIONAL_CLIENT_NAME: "TCS",
}));

vi.mock("@/lib/districts", () => ({
  districtKey: vi.fn((value: string) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    return ["trivandrum", "tvm", "trivandrum district"].includes(normalized)
      ? "thiruvananthapuram"
      : normalized;
  }),
  districtMatches: vi.fn(() => true),
  normalizeDistrictName: vi.fn((value: string) => value),
  normalizeOperationalZoneLabel: vi.fn((value: string) => value),
  canonicalizeDistrictName: vi.fn((value: string) => value),
  inferKeralaDistrictFromText: vi.fn(() => ""),
  isCanonicalKeralaDistrict: vi.fn(() => true),
  resolveKeralaDistrictFromRow: vi.fn((values: unknown[]) => String(values.find(Boolean) ?? "")),
}));

vi.mock("@/types/attendance", () => ({
  attendanceSubmissionSchema: {
    parse: vi.fn(),
  },
}));

vi.mock("@/lib/server/monitoring", () => ({
  SYSTEM_METRIC_NAMES: {
    attendanceSubmitSuccess: "attendanceSubmitSuccess",
    attendanceSubmitFailure: "attendanceSubmitFailure",
  },
  incrementSystemMetric: vi.fn(),
}));

describe("TCS exam work order import server slice", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    requireAdminMock.mockResolvedValue({
      uid: "admin-1",
      email: "admin@example.com",
    });
    verifyRequestAuthMock.mockResolvedValue({
      uid: "admin-1",
      email: "admin@example.com",
      role: "admin",
    });
    requireAdminOrFieldOfficerMock.mockImplementation((token) => token);
    buildBinaryHashMock.mockReturnValue("binary-hash-1");
    buildContentHashMock.mockReturnValue("content-hash-1");
    lookupLocationGeocodeMock.mockResolvedValue({
      lat: 10.123456,
      lng: 76.123456,
      formattedAddress: "Created Site, Ernakulam, Kerala, India",
      placeAccuracy: "OpenCage confidence 8/10",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("previews parsed workbook rows with hash and duplicate state metadata", async () => {
    const adminDb = new FakeFirestore();
    adminDb.seed("workOrderImports", "import-1", {
      contentHash: "content-hash-1",
      binaryFileHash: "other-binary-hash",
    });
    adminDb.seed("workOrders", "wo-active", {
      siteId: "site-a",
      siteName: "Alpha Site",
      clientName: "TCS",
      district: "Ernakulam",
      date: new Date("2026-04-21T00:00:00.000Z"),
      examCode: "tcs-exam",
      maleGuardsRequired: 2,
      femaleGuardsRequired: 1,
      totalManpower: 3,
      recordStatus: "active",
    });
    adminDb.seed("workOrders", "wo-cancelled", {
      siteId: "site-z",
      siteName: "Zulu Site",
      district: "Ernakulam",
      date: new Date("2026-04-21T00:00:00.000Z"),
      examCode: "tcs-exam",
      maleGuardsRequired: 4,
      femaleGuardsRequired: 2,
      totalManpower: 6,
      recordStatus: "cancelled",
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
    }));

    parseWorkbookMock.mockReturnValue({
      parserMode: "legacy-sheet",
      suggestedExamName: "TCS Exam",
      suggestedExamCode: "tcs-exam",
      dateRange: { from: "2026-04-21", to: "2026-04-21" },
      dates: ["2026-04-21"],
      rows: [
        {
          siteId: "site-a",
          siteName: "Alpha Site",
          district: "Ernakulam",
          date: "2026-04-21",
          examName: "TCS Exam",
          examCode: "tcs-exam",
          maleGuardsRequired: 3,
          femaleGuardsRequired: 1,
          sourceSheetName: "Sheet1",
          sourceRowNumber: 3,
        },
      ],
      siteCount: 1,
      rowCount: 1,
      totalMale: 3,
      totalFemale: 1,
      warnings: [],
    });
    buildDiffMock.mockReturnValue([
      {
        key: "site-id:site-a|date:2026-04-21|exam:tcs-exam",
        siteId: "site-a",
        siteName: "Alpha Site",
        district: "Ernakulam",
        date: "2026-04-21",
        examCode: "tcs-exam",
        maleGuardsRequired: 3,
        femaleGuardsRequired: 1,
        totalManpower: 4,
        status: "updated",
      },
    ]);

    const { POST } = await import("./api/admin/work-orders/import/preview/route");

    const formData = new FormData();
    formData.set(
      "file",
      new File([makeWorkbookBuffer()], "tcs-exam.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    formData.set("mode", "revision");

    const response = await POST(new Request("http://localhost/api/admin/work-orders/import/preview", {
      method: "POST",
      body: formData,
      headers: { authorization: "Bearer token" },
    }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.binaryFileHash).toBe("binary-hash-1");
    expect(payload.contentHash).toBe("content-hash-1");
    expect(payload.mode).toBe("revision");
    expect(payload.duplicateState).toBe("content-duplicate");
    expect(payload.diffRows).toHaveLength(1);
    expect(buildDiffMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "revision",
        existingRows: expect.arrayContaining([
          expect.objectContaining({
            id: "wo-active",
            recordStatus: "active",
          }),
        ]),
      }),
    );
  });

  it("allows re-upload when matching import hash has no active work orders left", async () => {
    const adminDb = new FakeFirestore();
    adminDb.seed("workOrderImports", "import-1", {
      contentHash: "content-hash-1",
      binaryFileHash: "binary-hash-1",
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
    }));

    parseWorkbookMock.mockReturnValue({
      parserMode: "legacy-sheet",
      suggestedExamName: "TCS Exam",
      suggestedExamCode: "tcs-exam",
      dateRange: { from: "2026-04-21", to: "2026-04-21" },
      dates: ["2026-04-21"],
      rows: [
        {
          siteId: "site-a",
          siteName: "Alpha Site",
          district: "Ernakulam",
          date: "2026-04-21",
          examName: "TCS Exam",
          examCode: "tcs-exam",
          maleGuardsRequired: 3,
          femaleGuardsRequired: 1,
          sourceSheetName: "Sheet1",
          sourceRowNumber: 3,
        },
      ],
      siteCount: 1,
      rowCount: 1,
      totalMale: 3,
      totalFemale: 1,
      warnings: [],
    });
    buildDiffMock.mockReturnValue([
      {
        key: "site-id:site-a|date:2026-04-21|exam:tcs-exam",
        siteId: "site-a",
        siteName: "Alpha Site",
        district: "Ernakulam",
        date: "2026-04-21",
        examCode: "tcs-exam",
        maleGuardsRequired: 3,
        femaleGuardsRequired: 1,
        totalManpower: 4,
        status: "added",
      },
    ]);

    const { POST } = await import("./api/admin/work-orders/import/preview/route");

    const formData = new FormData();
    formData.set(
      "file",
      new File([makeWorkbookBuffer()], "tcs-exam.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    formData.set("mode", "new");

    const response = await POST(new Request("http://localhost/api/admin/work-orders/import/preview", {
      method: "POST",
      body: formData,
      headers: { authorization: "Bearer token" },
    }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.duplicateState).toBe("none");
    expect(payload.duplicateMessage).toBeUndefined();
  });

  it("deletes import metadata when deleting the last work order from an import", async () => {
    const adminDb = new FakeFirestore();
    adminDb.seed("workOrderImports", "import-1", {
      contentHash: "content-hash-1",
      binaryFileHash: "binary-hash-1",
    });
    adminDb.seed("workOrders", "wo-1", {
      importId: "import-1",
      contentHash: "content-hash-1",
      binaryFileHash: "binary-hash-1",
      clientName: "TCS",
      recordStatus: "active",
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
    }));

    const { DELETE } = await import("./api/admin/work-orders/[id]/route");

    const response = await DELETE(
      new Request("http://localhost/api/admin/work-orders/wo-1", {
        method: "DELETE",
        headers: { authorization: "Bearer token" },
      }),
      { params: Promise.resolve({ id: "wo-1" }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.deleted).toBe(true);
    expect(payload.importsDeleted).toBe(1);
    expect(adminDb.listDocs("workOrders")).toHaveLength(0);
    expect(adminDb.listDocs("workOrderImports")).toHaveLength(0);
  });

  it("bulk row delete cleans stale import metadata used by the frontend delete action", async () => {
    const adminDb = new FakeFirestore();
    adminDb.seed("workOrderImports", "import-1", {
      contentHash: "content-hash-1",
      binaryFileHash: "binary-hash-1",
    });
    adminDb.seed("workOrders", "wo-1", {
      importId: "import-1",
      contentHash: "content-hash-1",
      binaryFileHash: "binary-hash-1",
      clientName: "TCS",
      recordStatus: "active",
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
    }));

    const { POST } = await import("./api/admin/work-orders/bulk-delete/route");

    const response = await POST(
      new Request("http://localhost/api/admin/work-orders/bulk-delete", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ workOrderIds: ["wo-1"] }),
      }) as any,
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.deleted).toBe(1);
    expect(payload.importsDeleted).toBe(1);
    expect(adminDb.listDocs("workOrders")).toHaveLength(0);
    expect(adminDb.listDocs("workOrderImports")).toHaveLength(0);
  });

  it("does not mark overlap when active rows share examCode but not identity scope", async () => {
    const adminDb = new FakeFirestore();
    adminDb.seed("workOrders", "wo-other-site", {
      siteId: "site-b",
      siteName: "Beta Site",
      district: "Ernakulam",
      date: new Date("2026-04-22T00:00:00.000Z"),
      examCode: "tcs-exam",
      maleGuardsRequired: 2,
      femaleGuardsRequired: 1,
      totalManpower: 3,
      recordStatus: "active",
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
    }));

    parseWorkbookMock.mockReturnValue({
      parserMode: "legacy-sheet",
      suggestedExamName: "TCS Exam",
      suggestedExamCode: "tcs-exam",
      dateRange: { from: "2026-04-21", to: "2026-04-21" },
      dates: ["2026-04-21"],
      rows: [
        {
          siteId: "site-a",
          siteName: "Alpha Site",
          district: "Ernakulam",
          date: "2026-04-21",
          examName: "TCS Exam",
          examCode: "tcs-exam",
          maleGuardsRequired: 3,
          femaleGuardsRequired: 1,
          sourceSheetName: "Sheet1",
          sourceRowNumber: 3,
        },
      ],
      siteCount: 1,
      rowCount: 1,
      totalMale: 3,
      totalFemale: 1,
      warnings: [],
    });
    buildDiffMock.mockReturnValue([
      {
        key: "site-id:site-a|date:2026-04-21|exam:tcs-exam",
        siteId: "site-a",
        siteName: "Alpha Site",
        district: "Ernakulam",
        date: "2026-04-21",
        examCode: "tcs-exam",
        maleGuardsRequired: 3,
        femaleGuardsRequired: 1,
        totalManpower: 4,
        status: "added",
      },
    ]);

    const { POST } = await import("./api/admin/work-orders/import/preview/route");

    const formData = new FormData();
    formData.set(
      "file",
      new File([makeWorkbookBuffer()], "tcs-exam.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    formData.set("mode", "new");

    const response = await POST(new Request("http://localhost/api/admin/work-orders/import/preview", {
      method: "POST",
      body: formData,
      headers: { authorization: "Bearer token" },
    }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.duplicateState).toBe("none");
    expect(payload.duplicateMessage).toBeUndefined();
  });

  it("marks overlap when parsed row lacks siteId but matches an existing concrete-site row by fallback identity", async () => {
    const adminDb = new FakeFirestore();
    adminDb.seed("workOrders", "wo-siteid", {
      siteId: "site-a",
      siteName: "Alpha Site",
      clientName: "TCS",
      district: "Ernakulam",
      date: new Date("2026-04-21T00:00:00.000Z"),
      examCode: "tcs-exam",
      maleGuardsRequired: 2,
      femaleGuardsRequired: 1,
      totalManpower: 3,
      recordStatus: "active",
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
    }));

    parseWorkbookMock.mockReturnValue({
      parserMode: "legacy-sheet",
      suggestedExamName: "TCS Exam",
      suggestedExamCode: "tcs-exam",
      dateRange: { from: "2026-04-21", to: "2026-04-21" },
      dates: ["2026-04-21"],
      rows: [
        {
          siteName: "Alpha Site",
          district: "Ernakulam",
          date: "2026-04-21",
          examName: "TCS Exam",
          examCode: "tcs-exam",
          maleGuardsRequired: 3,
          femaleGuardsRequired: 1,
          sourceSheetName: "Sheet1",
          sourceRowNumber: 3,
        },
      ],
      siteCount: 1,
      rowCount: 1,
      totalMale: 3,
      totalFemale: 1,
      warnings: [],
    });
    buildDiffMock.mockReturnValue([
      {
        key: "site-fallback:alpha site|district:ernakulam|date:2026-04-21|exam:tcs-exam",
        siteName: "Alpha Site",
        district: "Ernakulam",
        date: "2026-04-21",
        examCode: "tcs-exam",
        maleGuardsRequired: 3,
        femaleGuardsRequired: 1,
        totalManpower: 4,
        status: "updated",
      },
    ]);

    const { POST } = await import("./api/admin/work-orders/import/preview/route");

    const formData = new FormData();
    formData.set(
      "file",
      new File([makeWorkbookBuffer()], "tcs-exam.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    formData.set("mode", "new");

    const response = await POST(new Request("http://localhost/api/admin/work-orders/import/preview", {
      method: "POST",
      body: formData,
      headers: { authorization: "Bearer token" },
    }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.duplicateState).toBe("overlap");
  });

  it("commits active rows, cancels missing rows, and records import metadata", async () => {
    const adminDb = new FakeFirestore();
    adminDb.seed("workOrders", "existing-row", {
      siteId: "site-old",
      siteName: "Old Site",
      district: "Ernakulam",
      date: new Date("2026-04-21T00:00:00.000Z"),
      examName: "TCS Exam",
      examCode: "tcs-exam",
      maleGuardsRequired: 2,
      femaleGuardsRequired: 1,
      totalManpower: 3,
      assignedGuards: [{ uid: "guard-1" }],
      recordStatus: "active",
      importId: "import-old",
      sourceFileName: "older.xlsx",
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
    }));

    buildDiffMock.mockReturnValue([
      {
        key: "site-id:site-new|date:2026-04-22|exam:tcs-exam",
        siteId: "site-new",
        siteName: "New Site",
        district: "Ernakulam",
        date: "2026-04-22",
        examCode: "tcs-exam",
        maleGuardsRequired: 5,
        femaleGuardsRequired: 1,
        totalManpower: 6,
        status: "added",
      },
      {
        key: "site-id:site-old|date:2026-04-21|exam:tcs-exam",
        siteId: "site-old",
        siteName: "Old Site",
        district: "Ernakulam",
        date: "2026-04-21",
        examCode: "tcs-exam",
        maleGuardsRequired: 2,
        femaleGuardsRequired: 1,
        totalManpower: 3,
        status: "cancelled",
      },
    ]);

    const { POST } = await import("./api/admin/work-orders/import/commit/route");

    const response = await POST(new Request("http://localhost/api/admin/work-orders/import/commit", {
      method: "POST",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        mode: "revision",
        fileName: "tcs-exam.xlsx",
        parserMode: "legacy-sheet",
        examName: "TCS Exam",
        examCode: "tcs-exam",
        binaryFileHash: "binary-hash-1",
        contentHash: "content-hash-1",
        rows: [
          {
            siteId: "site-new",
            siteName: "New Site",
            district: "Ernakulam",
            date: "2026-04-22",
            examName: "TCS Exam",
            examCode: "tcs-exam",
            maleGuardsRequired: 5,
            femaleGuardsRequired: 1,
            sourceSheetName: "Sheet1",
            sourceRowNumber: 4,
          },
        ],
      }),
    }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.importId).toBeTruthy();

    const sites = adminDb.listDocs("sites");
    expect(sites).toHaveLength(1);
    const createdSiteId = sites[0]?.id;

    const activeRows = adminDb.listDocs("workOrders");
    expect(activeRows.some(({ id, data }) =>
      id === `${createdSiteId}_2026-04-22_tcs-exam` &&
      data.siteId === createdSiteId &&
      data.recordStatus === "active" &&
      data.importId === payload.importId &&
      data.binaryFileHash === "binary-hash-1")).toBe(true);
    expect(activeRows.some(({ id, data }) =>
      id === "existing-row" &&
      data.recordStatus === "cancelled")).toBe(true);

    const imports = adminDb.listDocs("workOrderImports");
    expect(imports).toHaveLength(1);
    expect(imports[0]?.data).toEqual(
      expect.objectContaining({
        id: payload.importId,
        fileName: "tcs-exam.xlsx",
        mode: "revision",
        binaryFileHash: "binary-hash-1",
        contentHash: "content-hash-1",
        committedRows: 1,
        cancelledRows: 1,
      }),
    );
  });

  it("replaces matching active work orders during a duplicate re-upload", async () => {
    const adminDb = new FakeFirestore();
    adminDb.seed("sites", "site-a", {
      id: "site-a",
      siteId: "site-a",
      siteName: "Alpha Site",
      district: "Ernakulam",
      clientName: "TCS",
    });
    adminDb.seed("workOrders", "existing-row", {
      siteId: "site-a",
      siteName: "Alpha Site",
      clientName: "TCS",
      district: "Ernakulam",
      date: new Date("2026-04-21T00:00:00.000Z"),
      examName: "TCS Exam",
      examCode: "tcs-exam",
      maleGuardsRequired: 2,
      femaleGuardsRequired: 1,
      totalManpower: 3,
      assignedGuards: [{ uid: "guard-1" }],
      recordStatus: "active",
      importId: "import-old",
      sourceFileName: "old.xlsx",
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
    }));

    buildDiffMock.mockReturnValue([
      {
        key: "site-id:site-a|date:2026-04-21|exam:tcs-exam",
        siteId: "site-a",
        siteName: "Alpha Site",
        district: "Ernakulam",
        date: "2026-04-21",
        examCode: "tcs-exam",
        maleGuardsRequired: 5,
        femaleGuardsRequired: 2,
        totalManpower: 7,
        status: "updated",
      },
    ]);

    const { POST } = await import("./api/admin/work-orders/import/commit/route");

    const response = await POST(new Request("http://localhost/api/admin/work-orders/import/commit", {
      method: "POST",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        mode: "new",
        duplicateResolution: "replace",
        fileName: "reupload.xlsx",
        parserMode: "legacy-sheet",
        examName: "TCS Exam",
        examCode: "tcs-exam",
        binaryFileHash: "binary-hash-1",
        contentHash: "content-hash-1",
        rows: [
          {
            siteId: "site-a",
            siteName: "Alpha Site",
            district: "Ernakulam",
            date: "2026-04-21",
            examName: "TCS Exam",
            examCode: "tcs-exam",
            maleGuardsRequired: 5,
            femaleGuardsRequired: 2,
            sourceSheetName: "Sheet1",
            sourceRowNumber: 4,
          },
        ],
      }),
    }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.committedRows).toBe(1);

    const updated = adminDb.getDoc("workOrders", "existing-row");
    expect(updated).toEqual(
      expect.objectContaining({
        maleGuardsRequired: 5,
        femaleGuardsRequired: 2,
        totalManpower: 7,
        sourceFileName: "reupload.xlsx",
        recordStatus: "active",
      }),
    );
    expect(updated?.assignedGuards).toEqual([{ uid: "guard-1" }]);
  });

  it("omits matching active work orders during a duplicate re-upload", async () => {
    const adminDb = new FakeFirestore();
    adminDb.seed("workOrders", "existing-row", {
      siteId: "site-a",
      siteName: "Alpha Site",
      clientName: "TCS",
      district: "Ernakulam",
      date: new Date("2026-04-21T00:00:00.000Z"),
      examName: "TCS Exam",
      examCode: "tcs-exam",
      maleGuardsRequired: 2,
      femaleGuardsRequired: 1,
      totalManpower: 3,
      assignedGuards: [{ uid: "guard-1" }],
      recordStatus: "active",
      importId: "import-old",
      sourceFileName: "old.xlsx",
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
    }));

    buildDiffMock.mockReturnValue([
      {
        key: "site-id:site-a|date:2026-04-21|exam:tcs-exam",
        siteId: "site-a",
        siteName: "Alpha Site",
        district: "Ernakulam",
        date: "2026-04-21",
        examCode: "tcs-exam",
        maleGuardsRequired: 5,
        femaleGuardsRequired: 2,
        totalManpower: 7,
        status: "updated",
      },
    ]);

    const { POST } = await import("./api/admin/work-orders/import/commit/route");

    const response = await POST(new Request("http://localhost/api/admin/work-orders/import/commit", {
      method: "POST",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        mode: "new",
        duplicateResolution: "omit",
        fileName: "reupload.xlsx",
        parserMode: "legacy-sheet",
        examName: "TCS Exam",
        examCode: "tcs-exam",
        binaryFileHash: "binary-hash-1",
        contentHash: "content-hash-1",
        rows: [
          {
            siteId: "site-a",
            siteName: "Alpha Site",
            district: "Ernakulam",
            date: "2026-04-21",
            examName: "TCS Exam",
            examCode: "tcs-exam",
            maleGuardsRequired: 5,
            femaleGuardsRequired: 2,
            sourceSheetName: "Sheet1",
            sourceRowNumber: 4,
          },
        ],
      }),
    }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.committedRows).toBe(0);
    expect(payload.createdSites).toBe(0);

    const unchanged = adminDb.getDoc("workOrders", "existing-row");
    expect(unchanged).toEqual(
      expect.objectContaining({
        maleGuardsRequired: 2,
        femaleGuardsRequired: 1,
        totalManpower: 3,
        sourceFileName: "old.xlsx",
      }),
    );
  });

  it("prefers updating the active duplicate instead of a cancelled duplicate doc", async () => {
    const adminDb = new FakeFirestore();
    adminDb.seed("workOrders", "dup-active", {
      siteId: "site-a",
      siteName: "Alpha Site",
      district: "Ernakulam",
      date: new Date("2026-04-21T00:00:00.000Z"),
      examName: "TCS Exam",
      examCode: "tcs-exam",
      maleGuardsRequired: 2,
      femaleGuardsRequired: 1,
      totalManpower: 3,
      assignedGuards: [{ uid: "guard-active" }],
      recordStatus: "active",
      importId: "import-old-active",
      sourceFileName: "active.xlsx",
    });
    adminDb.seed("workOrders", "dup-cancelled", {
      siteId: "site-a",
      siteName: "Alpha Site",
      district: "Ernakulam",
      date: new Date("2026-04-21T00:00:00.000Z"),
      examName: "TCS Exam",
      examCode: "tcs-exam",
      maleGuardsRequired: 1,
      femaleGuardsRequired: 0,
      totalManpower: 1,
      assignedGuards: [{ uid: "guard-cancelled" }],
      recordStatus: "cancelled",
      importId: "import-old-cancelled",
      sourceFileName: "cancelled.xlsx",
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
    }));

    buildDiffMock.mockReturnValue([
      {
        key: "site-id:site-a|date:2026-04-21|exam:tcs-exam",
        siteId: "site-a",
        siteName: "Alpha Site",
        district: "Ernakulam",
        date: "2026-04-21",
        examCode: "tcs-exam",
        maleGuardsRequired: 4,
        femaleGuardsRequired: 2,
        totalManpower: 6,
        status: "updated",
      },
    ]);

    const { POST } = await import("./api/admin/work-orders/import/commit/route");

    const response = await POST(new Request("http://localhost/api/admin/work-orders/import/commit", {
      method: "POST",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        mode: "revision",
        fileName: "tcs-exam.xlsx",
        parserMode: "legacy-sheet",
        examName: "TCS Exam",
        examCode: "tcs-exam",
        binaryFileHash: "binary-hash-1",
        contentHash: "content-hash-1",
        rows: [
          {
            siteId: "site-a",
            siteName: "Alpha Site",
            district: "Ernakulam",
            date: "2026-04-21",
            examName: "TCS Exam",
            examCode: "tcs-exam",
            maleGuardsRequired: 4,
            femaleGuardsRequired: 2,
            sourceSheetName: "Sheet1",
            sourceRowNumber: 3,
          },
        ],
      }),
    }));

    expect(response.status).toBe(200);

    const workOrders = adminDb.listDocs("workOrders");
    const updatedActive = workOrders.find(({ id }) => id === "dup-active")?.data;
    const unchangedCancelled = workOrders.find(({ id }) => id === "dup-cancelled")?.data;

    expect(updatedActive).toEqual(
      expect.objectContaining({
        recordStatus: "active",
        maleGuardsRequired: 4,
        femaleGuardsRequired: 2,
        assignedGuards: [{ uid: "guard-active" }],
        sourceFileName: "tcs-exam.xlsx",
      }),
    );
    expect(unchangedCancelled).toEqual(
      expect.objectContaining({
        recordStatus: "cancelled",
        maleGuardsRequired: 1,
        femaleGuardsRequired: 0,
        assignedGuards: [{ uid: "guard-cancelled" }],
        sourceFileName: "cancelled.xlsx",
      }),
    );
  });

  it("updates the existing active row when parsed revision row matches only by fallback identity", async () => {
    const adminDb = new FakeFirestore();
    adminDb.seed("workOrders", "existing-siteid-row", {
      siteId: "site-a",
      siteName: "Alpha Site",
      district: "Ernakulam",
      date: new Date("2026-04-21T00:00:00.000Z"),
      examName: "TCS Exam",
      examCode: "tcs-exam",
      maleGuardsRequired: 2,
      femaleGuardsRequired: 1,
      totalManpower: 3,
      assignedGuards: [{ uid: "guard-active" }],
      recordStatus: "active",
      importId: "import-old-active",
      sourceFileName: "active.xlsx",
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
    }));

    buildDiffMock.mockReturnValue([
      {
        key: "site-fallback:alpha site|district:ernakulam|date:2026-04-21|exam:tcs-exam",
        siteName: "Alpha Site",
        district: "Ernakulam",
        date: "2026-04-21",
        examCode: "tcs-exam",
        maleGuardsRequired: 4,
        femaleGuardsRequired: 2,
        totalManpower: 6,
        status: "updated",
      },
    ]);

    const { POST } = await import("./api/admin/work-orders/import/commit/route");

    const response = await POST(new Request("http://localhost/api/admin/work-orders/import/commit", {
      method: "POST",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        mode: "revision",
        fileName: "tcs-exam.xlsx",
        parserMode: "legacy-sheet",
        examName: "TCS Exam",
        examCode: "tcs-exam",
        binaryFileHash: "binary-hash-1",
        contentHash: "content-hash-1",
        rows: [
          {
            siteName: "Alpha Site",
            district: "Ernakulam",
            date: "2026-04-21",
            examName: "TCS Exam",
            examCode: "tcs-exam",
            maleGuardsRequired: 4,
            femaleGuardsRequired: 2,
            sourceSheetName: "Sheet1",
            sourceRowNumber: 3,
          },
        ],
      }),
    }));

    expect(response.status).toBe(200);
    const workOrders = adminDb.listDocs("workOrders");
    const updated = workOrders.find(({ id }) => id === "existing-siteid-row")?.data;
    expect(updated).toEqual(
      expect.objectContaining({
        recordStatus: "active",
        maleGuardsRequired: 4,
        femaleGuardsRequired: 2,
        totalManpower: 6,
        sourceFileName: "tcs-exam.xlsx",
      }),
    );
    expect(workOrders.some(({ id }) => id === "site_2026-04-21_tcs-exam")).toBe(false);
  });

  it("creates missing TCS sites during commit and links new work orders to the created site", async () => {
    const adminDb = new FakeFirestore();

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
    }));

    buildDiffMock.mockReturnValue([
      {
        key: "site-fallback:created site|district:ernakulam|date:2026-04-23|exam:tcs-exam",
        siteName: "Created Site",
        district: "Ernakulam",
        date: "2026-04-23",
        examCode: "tcs-exam",
        maleGuardsRequired: 6,
        femaleGuardsRequired: 2,
        totalManpower: 8,
        status: "added",
      },
    ]);

    const { POST } = await import("./api/admin/work-orders/import/commit/route");

    const response = await POST(new Request("http://localhost/api/admin/work-orders/import/commit", {
      method: "POST",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        mode: "new",
        fileName: "tcs-exam.xlsx",
        parserMode: "legacy-sheet",
        examName: "TCS Exam",
        examCode: "tcs-exam",
        binaryFileHash: "binary-hash-1",
        contentHash: "content-hash-1",
        rows: [
          {
            siteName: "Created Site",
            district: "Ernakulam",
            date: "2026-04-23",
            examName: "TCS Exam",
            examCode: "tcs-exam",
            maleGuardsRequired: 6,
            femaleGuardsRequired: 2,
            sourceSheetName: "Sheet1",
            sourceRowNumber: 7,
          },
        ],
      }),
    }));

    expect(response.status).toBe(200);

    const sites = adminDb.listDocs("sites");
    expect(sites).toHaveLength(1);
    const createdSiteId = sites[0]?.id;
    expect(sites[0]?.data).toEqual(
      expect.objectContaining({
        clientName: "TCS",
        siteName: "Created Site",
        district: "Ernakulam",
        coordinateStatus: "geocoded",
        coordinateSource: "geocode",
      }),
    );

    const workOrders = adminDb.listDocs("workOrders");
    expect(workOrders).toHaveLength(1);
    expect(workOrders[0]).toEqual(
      expect.objectContaining({
        id: `${createdSiteId}_2026-04-23_tcs-exam`,
        data: expect.objectContaining({
          siteId: createdSiteId,
          siteName: "Created Site",
          recordStatus: "active",
          examName: "TCS Exam",
          examCode: "tcs-exam",
        }),
      }),
    );
    expect(lookupLocationGeocodeMock).toHaveBeenCalled();
  });

  it("matches existing TCS sites by site code and district together", async () => {
    const adminDb = new FakeFirestore();
    adminDb.seed("sites", "marian-kochi", {
      siteId: "MARIAN",
      siteName: "Marian Engineering College",
      district: "Ernakulam",
      clientName: "TCS",
    });
    adminDb.seed("sites", "marian-tvm", {
      siteId: "MARIAN",
      siteName: "Marian Engineering College",
      district: "Thiruvananthapuram",
      clientName: "TCS",
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
    }));

    buildDiffMock.mockReturnValue([
      {
        key: "site-id:marian|date:2026-04-23|exam:tcs-exam",
        siteId: "MARIAN",
        siteName: "Marian Engineering College",
        district: "Trivandrum",
        date: "2026-04-23",
        examCode: "tcs-exam",
        maleGuardsRequired: 6,
        femaleGuardsRequired: 2,
        totalManpower: 8,
        status: "added",
      },
    ]);

    const { POST } = await import("./api/admin/work-orders/import/commit/route");

    const response = await POST(new Request("http://localhost/api/admin/work-orders/import/commit", {
      method: "POST",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        mode: "new",
        fileName: "tcs-exam.xlsx",
        parserMode: "legacy-sheet",
        examName: "TCS Exam",
        examCode: "tcs-exam",
        binaryFileHash: "binary-hash-1",
        contentHash: "content-hash-1",
        rows: [
          {
            siteId: "MARIAN",
            siteName: "Marian Engineering College",
            district: "Trivandrum",
            date: "2026-04-23",
            examName: "TCS Exam",
            examCode: "tcs-exam",
            maleGuardsRequired: 6,
            femaleGuardsRequired: 2,
            sourceSheetName: "Sheet1",
            sourceRowNumber: 7,
          },
        ],
      }),
    }));

    expect(response.status).toBe(200);
    const workOrders = adminDb.listDocs("workOrders");
    expect(workOrders.some(({ data }) => data.siteId === "marian-tvm")).toBe(true);
    expect(workOrders.some(({ data }) => data.siteId === "marian-kochi")).toBe(false);
  });

  it("matches attendance assignments across legacy string, uid, and employeeId shapes", async () => {
    expect(isAssignedGuardMatch(["guard-doc-1"], "guard-doc-1", "EMP-1")).toBe(true);
    expect(isAssignedGuardMatch([{ uid: "guard-doc-1" }], "guard-doc-1", "EMP-1")).toBe(true);
    expect(isAssignedGuardMatch([{ employeeId: "EMP-1" }], "guard-doc-1", "EMP-1")).toBe(true);
    expect(
      isAssignedGuardMatch(
        [{ uid: "someone-else" }, { employeeId: "EMP-1" }],
        "guard-doc-1",
        "EMP-1",
      ),
    ).toBe(true);
    expect(isAssignedGuardMatch([{ uid: "someone-else" }], "guard-doc-1", "EMP-1")).toBe(false);
  });

  it("patch route rejects unsafe provenance and lifecycle fields while allowing safe updates", async () => {
    const adminDb = new FakeFirestore();
    adminDb.seed("workOrders", "wo-1", {
      examName: "Old Exam",
      recordStatus: "active",
      importId: "import-1",
      sourceFileName: "old.xlsx",
      maleGuardsRequired: 2,
      femaleGuardsRequired: 1,
      totalManpower: 3,
      assignedGuards: [],
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
    }));

    const { PATCH } = await import("./api/admin/work-orders/[id]/route");

    const response = await PATCH(
      new Request("http://localhost/api/admin/work-orders/wo-1", {
        method: "PATCH",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          examName: "Updated Exam",
          maleGuardsRequired: 4,
          femaleGuardsRequired: 2,
          recordStatus: "cancelled",
          importId: "import-override",
          sourceFileName: "override.xlsx",
          binaryFileHash: "override-hash",
          contentHash: "override-content",
        }),
      }),
      { params: Promise.resolve({ id: "wo-1" }) },
    );

    expect(response.status).toBe(200);
    const updated = adminDb.getDoc("workOrders", "wo-1");
    expect(updated).toEqual(
      expect.objectContaining({
        examName: "Updated Exam",
        maleGuardsRequired: 4,
        femaleGuardsRequired: 2,
        totalManpower: 6,
        recordStatus: "active",
        importId: "import-1",
        sourceFileName: "old.xlsx",
      }),
    );
    expect(updated).not.toEqual(
      expect.objectContaining({
        binaryFileHash: "override-hash",
        contentHash: "override-content",
      }),
    );
  });

  it("patch route rejects assignmentHistory updates", async () => {
    const adminDb = new FakeFirestore();
    adminDb.seed("workOrders", "wo-history", {
      examName: "Exam",
      assignmentHistory: [{ action: "seeded" }],
      maleGuardsRequired: 1,
      femaleGuardsRequired: 1,
      totalManpower: 2,
    });

    vi.doMock("@/lib/firebaseAdmin", () => ({
      db: adminDb,
    }));

    const { PATCH } = await import("./api/admin/work-orders/[id]/route");

    const response = await PATCH(
      new Request("http://localhost/api/admin/work-orders/wo-history", {
        method: "PATCH",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          assignmentHistory: [{ action: "override" }],
          examName: "Changed",
        }),
      }),
      { params: Promise.resolve({ id: "wo-history" }) },
    );

    expect(response.status).toBe(400);
    expect(adminDb.getDoc("workOrders", "wo-history")).toEqual(
      expect.objectContaining({
        examName: "Exam",
        assignmentHistory: [{ action: "seeded" }],
      }),
    );
  });

  it("extends admin work order patching and active-only readers for exam imports", () => {
    const previewRouteSource = readFileSync(
      resolve(process.cwd(), "src/app/api/admin/work-orders/import/preview/route.ts"),
      "utf8",
    );
    const commitRouteSource = readFileSync(
      resolve(process.cwd(), "src/app/api/admin/work-orders/import/commit/route.ts"),
      "utf8",
    );
    const patchRouteSource = readFileSync(patchRoutePath, "utf8");
    const attendanceRouteSource = readFileSync(attendanceRoutePath, "utf8");
    const guardDashboardRouteSource = readFileSync(guardDashboardRoutePath, "utf8");

    expect(previewRouteSource).toContain('normalizeRecordStatus');
    expect(previewRouteSource).toContain('recordStatus: normalizeRecordStatus');
    expect(previewRouteSource).toContain('=== "active"');

    expect(commitRouteSource).toContain('normalizeRecordStatus');
    expect(commitRouteSource).toContain('recordStatus: normalizeRecordStatus');
    expect(commitRouteSource).toContain('=== "active"');
    expect(commitRouteSource).toContain('hasIdentityOverlap');
    expect(commitRouteSource).toContain('findMatchingExistingRow');

    expect(patchRouteSource).toContain('"examName"');
    expect(patchRouteSource).not.toContain('"recordStatus"');
    expect(patchRouteSource).not.toContain('"importId"');
    expect(patchRouteSource).not.toContain('"sourceFileName"');
    expect(patchRouteSource).not.toContain('"contentHash"');

    expect(attendanceRouteSource).toContain('recordStatus');
    expect(attendanceRouteSource).toContain('=== "active"');
    expect(attendanceRouteSource).not.toContain('.limit(5)');
    expect(attendanceRouteSource).toContain('isAssignedGuardMatch');
    expect(attendanceRouteSource).toContain('employeeId');
    expect(patchRouteSource).toContain('assignmentHistory cannot be updated via this route.');

    expect(guardDashboardRouteSource).toContain('recordStatus');
    expect(guardDashboardRouteSource).toContain('=== "active"');
    expect(guardDashboardRouteSource).not.toContain('.limit(100)');
  });
});
