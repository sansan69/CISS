import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

// Opt-in local emulator integration. Never points at a Firebase live project.
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const project = "demo-ciss-tcs-category-rules";
const runId = randomUUID();
const base = `http://${emulatorHost}`;
function token(role: string) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({
    iss: `https://securetoken.google.com/${project}`, aud: project,
    sub: `local-${role}`, user_id: `local-${role}`, iat: now, exp: now + 3600,
    role, admin: false, stateCode: "KL", email: `${role}@local.example`,
  })}.`;
}
function fields(data: Record<string, string>) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, { stringValue: value }]));
}
async function write(id: string, data: Record<string, string>, role = "admin") {
  return fetch(`${base}/v1/projects/${project}/databases/(default)/documents/employees/${id}-${runId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${role === "owner" ? "owner" : token(role)}` },
    body: JSON.stringify({ fields: fields(data) }),
  });
}

describe.skipIf(!emulatorHost)("TCS category Firestore rules (local emulator)", () => {
  beforeAll(async () => {
    const host = new URL(base).hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) throw new Error("Rules tests require a loopback emulator host.");
    const response = await fetch(`${base}/emulator/v1/projects/${project}:securityRules`, {
      method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
      body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content: readFileSync("firestore.rules", "utf8") }] } }),
    });
    expect(response.ok).toBe(true);
    const result = await response.json();
    expect((result.issues ?? []).filter((issue: { severity: string }) => issue.severity === "ERROR")).toEqual([]);
  });

  it("allows a canonical TCS administrator category create", async () => {
    expect((await write("valid-create", { clientName: " tCs ", tcsCategory: "adhoc", stateCode: "KL" })).status).toBe(200);
  });
  it("rejects invalid category creates", async () => {
    expect((await write("invalid-create", { clientName: "TCS", tcsCategory: "unknown", stateCode: "KL" })).status).toBe(403);
  });
  it("rejects non-TCS category creates", async () => {
    expect((await write("other-create", { clientName: "LNG Petronet", tcsCategory: "permanent", stateCode: "KL" })).status).toBe(403);
  });
  it.each(["guard", "fieldOfficer", "hr"])("denies direct category writes by %s", async (role) => {
    expect((await write(`role-${role}`, { clientName: "TCS", tcsCategory: "permanent", stateCode: "KL" }, role)).status).toBe(403);
  });
  it("allows unrelated admin edits to legacy absent and invalid category records", async () => {
    for (const category of [undefined, "unknown"]) {
      const data = { clientName: "TCS", stateCode: "KL", ...(category ? { tcsCategory: category } : {}) };
      const id = category ? "legacy-invalid" : "legacy-absent";
      expect((await write(id, data, "owner")).status).toBe(200);
      expect((await write(id, { ...data, fullName: "UPDATED GUARD" })).status).toBe(200);
    }
  });
  it("rejects retaining stale category on client reassignment but allows its removal", async () => {
    expect((await write("reassign", { clientName: "TCS", tcsCategory: "adhoc", stateCode: "KL" }, "owner")).status).toBe(200);
    expect((await write("reassign", { clientName: "LNG Petronet", tcsCategory: "adhoc", stateCode: "KL" })).status).toBe(403);
    expect((await write("reassign", { clientName: "LNG Petronet", stateCode: "KL" })).status).toBe(200);
  });
  it("allows validated curation of a legacy invalid category", async () => {
    expect((await write("curate", { clientName: "TCS", tcsCategory: "unknown", stateCode: "KL" }, "owner")).status).toBe(200);
    expect((await write("curate", { clientName: "TCS", tcsCategory: "permanent", stateCode: "KL" })).status).toBe(200);
  });
});
