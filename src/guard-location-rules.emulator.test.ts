import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

// Opt-in local emulator integration. Never points at a Firebase live project.
//
// Run with an arm64 JDK (the default `java` on some Macs is an x86_64 build and
// the emulator will not start):
//   JAVA_HOME=/Library/Java/JavaVirtualMachines/openjdk-21.jdk/Contents/Home \
//   npx firebase-tools emulators:exec --only firestore \
//     --project demo-ciss-guard-location-rules \
//     'npx vitest run src/guard-location-rules.emulator.test.ts'
//
// Scope note: the emulator cannot serve a subcollection list query at all — it
// hangs even for an owner-bypass request — so the guarded breadcrumb *list*
// rule is covered by the static assertion in src/database-config.test.ts. What
// is exercised here is the district-scoped guardLocations list contract the
// mobile live map relies on, plus the parent-document lookup helper on a
// single breadcrumb document read.
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const project = "demo-ciss-guard-location-rules";
const runId = randomUUID();
const base = `http://${emulatorHost}`;

function token(role: string, claims: Record<string, unknown> = {}) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({
    iss: `https://securetoken.google.com/${project}`,
    aud: project,
    sub: `local-${role}`,
    user_id: `local-${role}`,
    iat: now,
    exp: now + 3600,
    role,
    admin: false,
    stateCode: "KL",
    email: `${role}@local.example`,
    ...claims,
  })}.`;
}

function fields(data: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      typeof value === "boolean"
        ? { booleanValue: value }
        : typeof value === "number"
          ? { integerValue: String(value) }
          : { stringValue: String(value) },
    ]),
  );
}

async function seed(path: string, data: Record<string, unknown>) {
  return fetch(
    `${base}/v1/projects/${project}/databases/(default)/documents/${path}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
      body: JSON.stringify({ fields: fields(data) }),
    },
  );
}

async function runQuery(
  auth: string,
  structuredQuery: Record<string, unknown>,
) {
  return fetch(
    `${base}/v1/projects/${project}/databases/(default)/documents:runQuery`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth}` },
      body: JSON.stringify({ structuredQuery }),
    },
  );
}

async function getDocument(path: string, auth: string) {
  return fetch(
    `${base}/v1/projects/${project}/databases/(default)/documents/${path}`,
    { headers: { Authorization: `Bearer ${auth}` } },
  );
}

function listGuardLocations(district: string | null) {
  return {
    from: [{ collectionId: "guardLocations" }],
    ...(district
      ? {
          where: {
            fieldFilter: {
              field: { fieldPath: "district" },
              op: "EQUAL",
              value: { stringValue: district },
            },
          },
        }
      : {}),
  };
}

describe.skipIf(!emulatorHost)(
  "guard location Firestore rules (local emulator)",
  () => {
    const inScopeGuard = `emp-ernakulam-${runId}`;
    const outOfScopeGuard = `emp-kozhikode-${runId}`;

    beforeAll(async () => {
      if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname)) {
        throw new Error("Loopback emulator required.");
      }
      const response = await fetch(
        `${base}/emulator/v1/projects/${project}:securityRules`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
          body: JSON.stringify({
            rules: {
              files: [
                { name: "firestore.rules", content: readFileSync("firestore.rules", "utf8") },
              ],
            },
          }),
        },
      );
      expect(response.ok).toBe(true);
      expect((await response.json()).issues ?? []).toEqual([]);

      for (const [docId, district] of [
        [inScopeGuard, "Ernakulam"],
        [outOfScopeGuard, "Kozhikode"],
      ] as const) {
        const parent = await seed(`guardLocations/${docId}`, {
          district,
          stateCode: "KL",
          status: "In",
        });
        expect(parent.ok).toBe(true);
        const history = await seed(`guardLocations/${docId}/locationHistory/h1-${runId}`, {
          stateCode: "KL",
          recordedAt: "2026-10-14T06:00:00Z",
        });
        expect(history.ok).toBe(true);
      }
    });

    it("lets a field officer list live locations scoped to an assigned district", async () => {
      const response = await runQuery(
        token("fieldOfficer", { assignedDistricts: ["Ernakulam"] }),
        listGuardLocations("Ernakulam"),
      );
      expect(response.status).toBe(200);
      const rows = (await response.json()) as Array<Record<string, unknown>>;
      expect(rows.filter((row) => "document" in row)).toHaveLength(1);
    });

    it("refuses the same list query when the officer omits the district filter", async () => {
      // This is the regression the mobile live map had: a rule that reads a
      // field on the returned document cannot authorize an unfiltered list.
      const response = await runQuery(
        token("fieldOfficer", { assignedDistricts: ["Ernakulam"] }),
        listGuardLocations(null),
      );
      expect(response.status).toBe(403);
    });

    it("refuses a district outside the officer's assignment", async () => {
      const response = await runQuery(
        token("fieldOfficer", { assignedDistricts: ["Ernakulam"] }),
        listGuardLocations("Kozhikode"),
      );
      expect(response.status).toBe(403);
    });

    it("resolves the breadcrumb district from the parent document for an in-scope officer", async () => {
      const response = await getDocument(
        `guardLocations/${inScopeGuard}/locationHistory/h1-${runId}`,
        token("fieldOfficer", { assignedDistricts: ["Ernakulam"] }),
      );
      expect(response.status).toBe(200);
    });

    it("denies a breadcrumb document outside the officer's districts", async () => {
      const response = await getDocument(
        `guardLocations/${outOfScopeGuard}/locationHistory/h1-${runId}`,
        token("fieldOfficer", { assignedDistricts: ["Ernakulam"] }),
      );
      expect(response.status).toBe(403);
    });

    it("denies a guard reading another guard's breadcrumbs", async () => {
      const response = await getDocument(
        `guardLocations/${inScopeGuard}/locationHistory/h1-${runId}`,
        token("guard", { employeeDocId: `someone-else-${runId}` }),
      );
      expect(response.status).toBe(403);
    });

    it("still lets staff roles read breadcrumbs", async () => {
      for (const role of ["admin", "hr", "accounts", "compliance"]) {
        const response = await getDocument(
          `guardLocations/${outOfScopeGuard}/locationHistory/h1-${runId}`,
          token(role),
        );
        expect({ role, status: response.status }).toEqual({ role, status: 200 });
      }
    });
  },
);
