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

function matchingAllowRules(rules: string, collection: string): string[] {
  const masked = maskCommentsAndStrings(rules);
  const blocks: Array<{ path: string; start: number; end: number; bodyStart: number }> = [];
  const matchHeader = /\bmatch\s+(\/(?:[^{}\/\s]+|\{[^{}]*\})(?:\/(?:[^{}\/\s]+|\{[^{}]*\}))*)\s*\{/g;

  for (let match = matchHeader.exec(masked); match; match = matchHeader.exec(masked)) {
    const open = matchHeader.lastIndex - 1;
    let depth = 1;
    let close = open + 1;
    for (; close < masked.length && depth > 0; close += 1) {
      if (masked[close] === "{") depth += 1;
      if (masked[close] === "}") depth -= 1;
    }
    if (depth !== 0) continue;
    blocks.push({ path: match[1], start: match.index, end: close, bodyStart: open + 1 });
  }

  function parentOf(block: (typeof blocks)[number]) {
    return blocks
      .filter((candidate) => candidate.start < block.start && candidate.end >= block.end)
      .sort((left, right) => left.end - left.start - (right.end - right.start))[0];
  }

  function fullPath(block: (typeof blocks)[number]): string[] {
    const pathSegments = block.path.split("/").filter(Boolean);
    const parent = parentOf(block);
    const segments = [...(parent ? fullPath(parent) : []), ...pathSegments];
    return segments[0] === "databases" && segments.length >= 3 ? segments.slice(3) : segments;
  }

  function matchesPath(pattern: string[], target: string[], patternIndex = 0, targetIndex = 0): boolean {
    if (patternIndex === pattern.length) return targetIndex === target.length;
    const segment = pattern[patternIndex];
    if (/^\{[^{}]*=\*\*\}$/.test(segment.replace(/\s+/g, ""))) {
      if (patternIndex === pattern.length - 1) return true;
      for (let consumed = 0; targetIndex + consumed <= target.length; consumed += 1) {
        if (matchesPath(pattern, target, patternIndex + 1, targetIndex + consumed)) return true;
      }
      return false;
    }
    if (targetIndex >= target.length) return false;
    const anyDocumentId = target[targetIndex] === "__any_document_id__";
    if (!anyDocumentId && !/^\{[^{}]+\}$/.test(segment) && segment !== target[targetIndex]) return false;
    return matchesPath(pattern, target, patternIndex + 1, targetIndex + 1);
  }

  function matchesDocumentUnderCollection(pattern: string[], collectionName: string): boolean {
    // A retired top-level collection includes its direct documents and every
    // nested document below them. Try enough path lengths to cover every
    // fixed segment in the match, plus a document path at the collection root.
    for (let length = 2; length <= pattern.length + 2; length += 1) {
      const target = [collectionName, ...Array.from({ length: length - 1 }, () => "__any_document_id__")];
      if (matchesPath(pattern, target)) return true;
    }
    return false;
  }

  return blocks.flatMap((block) => {
    if (!matchesDocumentUnderCollection(fullPath(block), collection)) return [];
    const body = masked.slice(block.bodyStart, block.end - 1);
    const nestedBlocks = blocks.filter(
      (candidate) => candidate.start > block.start && candidate.end < block.end,
    );
    return Array.from(body.matchAll(/\ballow\s+([^;]+);/g)).flatMap(([, rule], index, matches) => {
      const offset = block.bodyStart + matches[index].index!;
      return nestedBlocks.some((nested) => nested.start <= offset && offset < nested.end)
        ? []
        : [rule.trim()];
    });
  });
}

function maskCommentsAndStrings(source: string): string {
  const chars = source.split("");
  let state: "code" | "line-comment" | "block-comment" | "single-string" | "double-string" = "code";
  let escaped = false;

  for (let index = 0; index < chars.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (state === "code") {
      if (current === "/" && next === "/") {
        chars[index] = chars[index + 1] = " ";
        index += 1;
        state = "line-comment";
      } else if (current === "/" && next === "*") {
        chars[index] = chars[index + 1] = " ";
        index += 1;
        state = "block-comment";
      } else if (current === "'") {
        chars[index] = " ";
        state = "single-string";
      } else if (current === '"') {
        chars[index] = " ";
        state = "double-string";
      }
      continue;
    }

    if (current !== "\n") chars[index] = " ";
    if (state === "line-comment") {
      if (current === "\n") state = "code";
      continue;
    }
    if (state === "block-comment") {
      if (current === "*" && next === "/") {
        chars[index + 1] = " ";
        index += 1;
        state = "code";
      }
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (current === "\\") {
      escaped = true;
      continue;
    }
    if ((state === "single-string" && current === "'") || (state === "double-string" && current === '"')) {
      state = "code";
    }
  }

  return chars.join("");
}

function isPermissiveAllow(rule: string): boolean {
  return !/^(?:read|write|create|update|delete)(?:\s*,\s*(?:read|write|create|update|delete))*\s*:\s*if\s+false$/.test(
    rule,
  );
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
        collectionGroup: "attendanceLogs",
        queryScope: "COLLECTION",
        fields: [
          { fieldPath: "clientName", order: "ASCENDING" },
          { fieldPath: "reportedAt", order: "DESCENDING" },
          { fieldPath: "__name__", order: "DESCENDING" },
        ],
      },
      {
        collectionGroup: "attendanceLogs",
        queryScope: "COLLECTION",
        fields: [
          { fieldPath: "employeeClientName", order: "ASCENDING" },
          { fieldPath: "reportedAt", order: "DESCENDING" },
          { fieldPath: "__name__", order: "DESCENDING" },
        ],
      },
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

  it.each([
    [
      "literal-document rule",
      `match /payrollEntries/{entryId} {
        allow read, write: if false;
      }
      match /payrollEntries/entry-123 {
        allow read: if true;
      }`,
    ],
    [
      "line-break-formatted duplicate wildcard rule",
      `match /payrollEntries/{entryId} {
        allow read, write: if false;
      }
      match /payrollEntries/{entryId}
      {
        allow read: if true;
      }`,
    ],
    [
      "root recursive rule",
      `match /payrollEntries/{entryId} {
        allow read, write: if false;
      }
      match /{document=**} {
        allow read: if true;
      }`,
    ],
    [
      "root variable rule",
      `match /payrollEntries/{entryId} {
        allow read, write: if false;
      }
      match /{collection}/{documentId} {
        allow read: if true;
      }`,
    ],
    [
      "nested equivalent rule",
      `match /payrollEntries/{entryId} {
        allow read, write: if false;
      }
      match /payrollEntries {
        match /{entryId} {
          allow read: if true;
        }
      }`,
    ],
    [
      "sibling database-root nested literal document rule with alternate database variable",
      `match /databases/{db}/documents {
        match /payrollEntries/{entryId} {
          allow read, write: if false;
        }
        match /payrollEntries/special {
          allow read: if true;
        }
      }`,
    ],
    [
      "absolute database-root literal document rule with alternate database variable",
      `match /databases/{database}/documents/payrollEntries/{entryId} {
        allow read, write: if false;
      }
      match /databases/{db}/documents/payrollEntries/special {
        allow read: if true;
      }`,
    ],
    [
      "service-level database-root literal document rule",
      `match /databases/{db}/{root}/payrollEntries/special {
        allow read: if true;
      }`,
    ],
    [
      "split database-root nested literal document rule",
      `match /databases/{db} {
        match /documents/payrollEntries/special {
          allow read: if true;
        }
      }`,
    ],
    [
      "literal database-root literal document rule",
      `match /databases/(default)/documents/payrollEntries/special {
        allow read: if true;
      }`,
    ],
    [
      "whitespace recursive wildcard database-root rule",
      `match /databases/{db}/documents/{document = **} {
        allow read: if true;
      }`,
    ],
    [
      "nested descendant permit under retired collection",
      `match /databases/{database}/documents {
        match /payrollEntries/{entryId} {
          allow read, write: if false;
        }
        match /payrollEntries/{entryId}/history/{recordId} {
          allow read: if true;
        }
      }`,
    ],
    [
      "absolute descendant permit under retired collection",
      `match /databases/{database}/documents/payrollEntries/{entryId}/history/{recordId} {
        allow read: if true;
      }`,
    ],
  ])("detects permissive grants in an overlapping %s", (_name, fixture) => {
    expect(matchingAllowRules(fixture, "payrollEntries").some(isPermissiveAllow)).toBe(true);
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
      "_diagnostics",
      "appConfig",
      "config",
      "enrollmentIdentities",
      "employeeAadhaarPrivate",
      "awards",
      "employeeIds",
      "enrollments",
      "evaluations",
      "guardPinResetEvents",
      "guardScores",
      "guardPatrolActivities",
      "incidents",
      "leaveRequests",
      "notificationReadStates",
      "questionBanks",
      "qrCodes",
      "quizAttempts",
      "regionAutomationJobs",
      "trainingAssignments",
      "trainingModules",
      "workOrderAssignmentEvents",
      "workOrderImports",
      "workOrderRevisionEvents",
      "sensitiveDocumentAuditLogs",
    ]) {
      expect(rules).toMatch(
        new RegExp(
          `match /${collection.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\{[^}]+\\} \\{[\\s\\S]*?allow read, write: if false;`,
        ),
      );
    }
  });

  it("resolves the guard-location district from the parent document so a field officer can list breadcrumbs", () => {
    const rules = read("firestore.rules");

    // A list query cannot be authorized from a field on the returned history
    // document, so the condition must read the parent guardLocations doc.
    expect(rules).toMatch(
      /function officerOwnsGuardLocation\(employeeId\)[\s\S]*?get\(\/databases\/\$\(database\)\/documents\/guardLocations\/\$\(employeeId\)\)\.data\.district[\s\S]*?in request\.auth\.token\.assignedDistricts;/,
    );
    expect(rules).toMatch(
      /match \/locationHistory\/\{historyId\}[\s\S]*?officerOwnsGuardLocation\(employeeId\)/,
    );
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

  it("scopes signature, attendance selfie, and officer report evidence reads to staff", () => {
    const rules = read("storage.rules");
    const block = (header: string) => {
      const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return rules.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    };

    // Guard and client roles must reach their own files through Admin-SDK
    // server routes; the browser storage SDK is a staff-only surface.
    const signatures = block("match /employees/{employeeKey}/signatures/{fileName}");
    expect(signatures).toContain("allow read: if isStaff();");
    expect(signatures).not.toContain("allow read: if isSignedIn();");

    const attendance = block("match /employees/{employeeKey}/attendance/{attemptId}/{fileName}");
    expect(attendance).toContain("allow read: if isStaff();");
    expect(attendance).not.toContain("allow read: if isSignedIn();");

    // Profile pictures stay readable by any authenticated user.
    const profilePictures = block("match /employees/{employeeKey}/profilePictures/{fileName}");
    expect(profilePictures).toContain("allow read: if isSignedIn();");

    // Field officers read only their own legacy report evidence; admins read all.
    const legacyEvidence = block("match /foReports/{folder}/{uid}/{fileName}");
    expect(legacyEvidence).toContain(
      "allow read: if isAdmin() || (isFieldOfficer() && request.auth.uid == uid);",
    );

    // isStaff() mirrors firestore.rules and must not include guard/client roles.
    const staffHelper = rules.match(/function isStaff\(\)\s*\{[\s\S]*?\}/)?.[0] ?? "";
    expect(staffHelper).toContain("isAdmin()");
    expect(staffHelper).toContain("isHR()");
    expect(staffHelper).toContain("isAccounts()");
    expect(staffHelper).toContain("isCompliance()");
    expect(staffHelper).toContain("isFieldOfficer()");
    expect(staffHelper).not.toMatch(/isGuard|isClientUser|isSignedIn/);

    // The catch-all must keep denying rather than reopening the bucket.
    expect(rules).toMatch(
      /match \/\{allPaths=\*\*\} \{\s*allow read, write: if false;\s*\}/,
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
