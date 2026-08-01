import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

type FirestoreIndex = {
  collectionGroup: string;
  queryScope: string;
  fields: Array<{
    fieldPath: string;
    order?: "ASCENDING" | "DESCENDING";
    arrayConfig?: "CONTAINS";
  }>;
};

function indexSignature(index: FirestoreIndex) {
  return JSON.stringify({
    collectionGroup: index.collectionGroup,
    queryScope: index.queryScope,
    fields: index.fields,
  });
}

describe("database access configuration", () => {
  it("keeps every declared Firestore composite index unique", () => {
    const config = JSON.parse(read("firestore.indexes.json")) as {
      indexes: FirestoreIndex[];
    };
    const signatures = config.indexes.map(indexSignature);

    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it("declares the composite indexes used by scoped work-order and attendance queries", () => {
    const config = JSON.parse(read("firestore.indexes.json")) as {
      indexes: FirestoreIndex[];
    };
    const signatures = new Set(config.indexes.map(indexSignature));

    const expected: FirestoreIndex[] = [
      {
        collectionGroup: "workOrders",
        queryScope: "COLLECTION",
        fields: [
          { fieldPath: "clientName", order: "ASCENDING" },
          { fieldPath: "date", order: "ASCENDING" },
          { fieldPath: "__name__", order: "ASCENDING" },
        ],
      },
      {
        collectionGroup: "workOrders",
        queryScope: "COLLECTION",
        fields: [
          { fieldPath: "district", order: "ASCENDING" },
          { fieldPath: "date", order: "ASCENDING" },
          { fieldPath: "__name__", order: "ASCENDING" },
        ],
      },
      {
        collectionGroup: "attendanceLogs",
        queryScope: "COLLECTION",
        fields: [
          { fieldPath: "employeeDocId", order: "ASCENDING" },
          { fieldPath: "createdAt", order: "ASCENDING" },
          { fieldPath: "__name__", order: "ASCENDING" },
        ],
      },
    ];

    for (const index of expected) {
      expect(signatures.has(indexSignature(index))).toBe(true);
    }
  });

  it("scopes field-officer employee reads and explicitly denies server-only collections", () => {
    const rules = read("firestore.rules");

    expect(rules).toContain("function isFieldOfficerForEmployee()");
    expect(rules).toMatch(
      /match \/employees\/\{employeeId\}[\s\S]*?isFieldOfficerForEmployee\(\)/,
    );
    expect(rules).toMatch(
      /match \/resetOtps\/\{otpId\}[\s\S]*?allow read, write: if false;/,
    );

    for (const collection of [
      "employeeAadhaarPrivate",
      "awards",
      "employeeIds",
      "enrollments",
      "evaluations",
      "guardScores",
      "guardPatrolActivities",
      "incidents",
      "leaveRequests",
      "notificationReadStates",
      "questionBanks",
      "quizAttempts",
      "regionAutomationJobs",
      "trainingAssignments",
      "trainingModules",
      "workOrderImports",
      "sensitiveDocumentAuditLogs",
    ]) {
      expect(rules).toMatch(
        new RegExp(
          `match /${collection.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\{[^}]+\\} \\{[\\s\\S]*?allow read, write: if false;`,
        ),
      );
    }
  });

  it("validates replacement uploads and keeps enrollment uploads server-only", () => {
    const rules = read("storage.rules");

    expect(rules).toMatch(
      /match \/employees\/\{employeeKey\}\/profilePictures\/\{fileName\}[\s\S]*?allow update: if isAdmin\(\) && isAllowedSize\(\) && isImage\(\);/,
    );
    expect(rules).toMatch(
      /match \/employees\/\{employeeKey\}\/idProofs\/\{fileName\}[\s\S]*?allow update: if isAdmin\(\) && isAllowedSize\(\) && isDocument\(\);/,
    );
    expect(rules).toMatch(
      /match \/enrollments\/\{employeeKey\}\/profilePictures\/\{fileName\}[\s\S]*?allow create: if false;[\s\S]*?allow update: if false;/,
    );
    expect(rules).toMatch(
      /match \/restrictedEmployeeAadhaar\/\{employeeId\}\/\{fileName\}[\s\S]*?allow read, write: if false;/,
    );
    expect(rules).toMatch(
      /match \/employees\/\{employeeKey\}\/aadharCards\/\{fileName\}[\s\S]*?allow read, write: if false;/,
    );
    expect(rules).toMatch(
      /match \/enrollments\/\{employeeKey\}\/aadharCards\/\{fileName\}[\s\S]*?allow read, write: if false;/,
    );
  });

  it("constrains client work-order queries to the authenticated client", () => {
    const source = read("src/app/(app)/work-orders/page.tsx");

    expect(source).toMatch(
      /isClientView && clientInfo\?\.clientName[\s\S]*?where\("clientName", "==", clientInfo\.clientName\)[\s\S]*?where\("date", ">=", todayTs\)/,
    );
  });

  it("authorizes evaluation APIs and derives employee scope from stored data", () => {
    const source = read("src/app/api/admin/evaluations/route.ts");

    expect(source).toContain(
      "requireAdminOrFieldOfficer(await verifyRequestAuth(request))",
    );
    expect(source).toContain(
      'adminDb.collection("employees").doc(body.employeeId).get()',
    );
    expect(source).toContain(
      "!employeeMatchesAnyDistrict(employee, assignedDistricts)",
    );
  });
});
