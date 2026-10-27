import { afterEach, describe, expect, it, vi } from "vitest";

const PROJECT_ID = "ciss-tn-example";
const BUCKET = `${PROJECT_ID}.firebasestorage.app`;

/** Obviously fake key material — no real credential is used anywhere here. */
const SERVICE_ACCOUNT = {
  type: "service_account",
  project_id: PROJECT_ID,
  private_key_id: "0000000000000000000000000000000000000000",
  private_key:
    "-----BEGIN PRIVATE KEY-----\\nMIIBVAIBADANBgkqhkiG9w0BAQEFAASCAT4wggE6AgEAAkEA\\n-----END PRIVATE KEY-----\\n",
  client_email: `region-admin@${PROJECT_ID}.iam.gserviceaccount.com`,
  client_id: "100000000001",
  token_uri: "https://oauth2.googleapis.com/token",
};
const SERVICE_ACCOUNT_JSON = JSON.stringify(SERVICE_ACCOUNT);

const BASE_REGION = {
  regionCode: "TN",
  regionName: "Tamil Nadu",
  status: "validated",
  firebaseProjectId: PROJECT_ID,
  storageBucket: BUCKET,
  onboardingChecklist: {
    metadataSaved: true,
    firebaseValidated: true,
    defaultsSeeded: false,
    regionAdminCreated: false,
    vercelConfigured: false,
  },
};

type Harness = {
  saved: Record<string, any>[];
  audits: Record<string, any>[];
  deployRules: ReturnType<typeof vi.fn>;
  deployStorageRules: ReturnType<typeof vi.fn>;
  deployIndexes: ReturnType<typeof vi.fn>;
  verifyBucket: ReturnType<typeof vi.fn>;
  readFiles: ReturnType<typeof vi.fn>;
};

function mockModules(
  options: {
    regionExists?: boolean;
    region?: Record<string, any>;
    connection?: Record<string, any> | null;
    unauthorized?: boolean;
    bucketFails?: boolean;
    indexesFail?: boolean;
    filesUnreadable?: boolean;
  } = {},
): Harness {
  const saved: Record<string, any>[] = [];
  const audits: Record<string, any>[] = [];
  const region = { ...BASE_REGION, ...(options.region ?? {}) };
  const exists = options.regionExists !== false;

  const deployRules = vi.fn(async () => undefined);
  const deployStorageRules = vi.fn(async () => undefined);
  const deployIndexes = vi.fn(async () => {
    if (options.indexesFail) throw new Error("Firestore API error (403): caller lacks firestore.indexes.create");
    return { created: 3, existing: 135, pending: 2 };
  });
  const verifyBucket = vi.fn(async () => {
    if (options.bucketFails) throw new Error("storage bucket not reachable");
    return { bucket: BUCKET, location: "ASIA-SOUTH1" };
  });
  const readFiles = vi.fn(async () => {
    if (options.filesUnreadable) throw new Error("firestore.rules could not be read at /app/firestore.rules.");
    return {
      firestoreRules: "rules_version = '2';",
      storageRules: "rules_version = '2';",
      indexesFile: "/app/firestore.indexes.json",
    };
  });

  const connection =
    options.connection === null
      ? null
      : options.connection ?? {
          firebaseProjectId: PROJECT_ID,
          storageBucket: BUCKET,
          serviceAccountJson: SERVICE_ACCOUNT_JSON,
        };

  const db = {
    collection: vi.fn((name: string) => {
      if (name === "regionOnboardingAudit") {
        return {
          add: vi.fn(async (doc: Record<string, any>) => {
            audits.push(doc);
            return { id: "audit-1" };
          }),
        };
      }
      return {
        doc: vi.fn(() => ({
          get: vi.fn(async () => ({ exists, id: region.regionCode, data: () => region })),
          set: vi.fn(async (doc: Record<string, any>) => {
            saved.push(doc);
          }),
        })),
      };
    }),
  };

  vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
  vi.doMock("@/lib/server/auth", () => ({
    requireSuperAdmin: vi.fn(async () => {
      if (options.unauthorized) throw new Error("Super admin access required.");
      return { uid: "super-admin-1", email: "super@example.test", role: "superAdmin" };
    }),
  }));
  vi.doMock("@/lib/server/region-connections", () => ({
    getRegionConnection: vi.fn(async () => connection),
  }));

  // Keep the real (pure) bucket-name normalisation; stub only the network work.
  vi.doMock("@/lib/server/firebase-management-client", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/server/firebase-management-client")>();
    return {
      ...actual,
      deployFirestoreRules: deployRules,
      deployStorageRules,
      deployFirestoreIndexes: deployIndexes,
      verifyStorageBucketWithRegionCredentials: verifyBucket,
      readDatabaseConfigFiles: readFiles,
    };
  });

  return { saved, audits, deployRules, deployStorageRules, deployIndexes, verifyBucket, readFiles };
}

async function callSetup(
  method: "GET" | "POST",
  id = "tn",
) {
  const route = await import("./route");
  const handler = method === "POST" ? route.POST : route.GET;
  const response = await handler(
    new Request(`https://example.test/api/super-admin/regions/${id}/database-setup`, {
      method,
    }),
    { params: Promise.resolve({ id }) },
  );
  const text = await response.text();
  return { response, text, body: text ? JSON.parse(text) : null };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("POST /api/super-admin/regions/[id]/database-setup", () => {
  it("deploys rules and indexes with the region service account", async () => {
    const harness = mockModules();

    const { response, text, body } = await callSetup("POST");

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.status).toBe("complete");
    expect(body.regionCode).toBe("TN");

    const steps = Object.fromEntries((body.steps as any[]).map((step) => [step.step, step]));
    expect(steps.bucket.status).toBe("verified");
    expect(steps.firestoreRules.status).toBe("deployed");
    expect(steps.storageRules.status).toBe("deployed");
    expect(steps.indexes.status).toBe("deployed");
    expect(steps.indexes.created).toBe(3);
    expect(steps.indexes.existing).toBe(135);
    expect(steps.indexes.pending).toBe(2);

    // The region's own key is used for every deploy, never HQ ADC.
    expect(harness.verifyBucket).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      storageBucket: BUCKET,
      serviceAccountJson: SERVICE_ACCOUNT_JSON,
    });
    expect(harness.deployRules).toHaveBeenCalledWith(PROJECT_ID, expect.any(String), SERVICE_ACCOUNT_JSON);
    expect(harness.deployStorageRules).toHaveBeenCalledWith(PROJECT_ID, expect.any(String), SERVICE_ACCOUNT_JSON);
    const indexesArgs = harness.deployIndexes.mock.calls[0] as unknown as [string, Record<string, any>];
    expect(indexesArgs[0]).toBe(PROJECT_ID);
    expect(indexesArgs[1].serviceAccountJson).toBe(SERVICE_ACCOUNT_JSON);

    // Checklist + stored status persist without the credential.
    expect(harness.saved).toHaveLength(1);
    const saved = harness.saved[0];
    expect(saved.onboardingChecklist.rulesDeployed).toBe(true);
    expect(saved.onboardingChecklist.indexesDeployed).toBe(true);
    expect(saved.onboardingChecklist.storageBucketVerified).toBe(true);
    expect(saved.databaseSetup.rulesDeployedAt).toBeTruthy();
    expect(saved.databaseSetup.storageRulesDeployedAt).toBeTruthy();
    expect(saved.databaseSetup.bucketVerifiedAt).toBeTruthy();
    expect(saved.databaseSetup.indexes).toMatchObject({ created: 3, existing: 135, pending: 2 });
    expect(JSON.stringify(saved)).not.toContain("BEGIN PRIVATE KEY");

    expect(harness.audits).toHaveLength(1);
    const audit = harness.audits[0];
    expect(audit.action).toBe("region_database_setup");
    expect(audit.success).toBe(true);
    expect(JSON.stringify(audit)).not.toContain("BEGIN PRIVATE KEY");

    // No credential material in the response.
    expect(text).not.toContain("BEGIN PRIVATE KEY");
    expect(text).not.toContain(SERVICE_ACCOUNT.client_email);
    expect(text).not.toContain(SERVICE_ACCOUNT.private_key_id);
  });

  it("returns 422 when the region has no stored service account", async () => {
    const harness = mockModules({ connection: null });

    const { response, body } = await callSetup("POST");

    expect(response.status).toBe(422);
    expect(body.error).toMatch(/No service account is stored/i);
    expect(harness.readFiles).not.toHaveBeenCalled();
    expect(harness.deployRules).not.toHaveBeenCalled();
    expect(harness.saved).toHaveLength(0);
  });

  it("returns 422 when the region has no Storage bucket", async () => {
    const harness = mockModules({
      region: { storageBucket: null },
      connection: {
        firebaseProjectId: PROJECT_ID,
        storageBucket: null,
        serviceAccountJson: SERVICE_ACCOUNT_JSON,
      },
    });

    const { response, body } = await callSetup("POST");

    expect(response.status).toBe(422);
    expect(body.error).toMatch(/no Storage bucket/i);
    expect(harness.deployRules).not.toHaveBeenCalled();
    expect(harness.deployRules).not.toHaveBeenCalled();
    expect(harness.saved).toHaveLength(0);
  });

  it("rejects a connection whose project differs from the region project", async () => {
    const harness = mockModules({
      connection: {
        firebaseProjectId: "someone-elses-project",
        storageBucket: BUCKET,
        serviceAccountJson: SERVICE_ACCOUNT_JSON,
      },
    });

    const { response, body } = await callSetup("POST");

    expect(response.status).toBe(422);
    expect(body.error).toMatch(/belongs to "someone-elses-project"/);
    expect(harness.deployRules).not.toHaveBeenCalled();
    expect(harness.saved).toHaveLength(0);
  });

  it("returns 404 for an unknown region", async () => {
    const harness = mockModules({ regionExists: false });

    const { response, body } = await callSetup("POST");

    expect(response.status).toBe(404);
    expect(body.error).toMatch(/Region not found/i);
    expect(harness.deployRules).not.toHaveBeenCalled();
  });

  it("returns 403 for a non super-admin caller", async () => {
    const harness = mockModules({ unauthorized: true });

    const { response, body } = await callSetup("POST");

    expect(response.status).toBe(403);
    expect(body.error).toMatch(/Super admin access required/i);
    expect(harness.saved).toHaveLength(0);
  });

  it("reports a partial run with 207 and keeps the completed steps", async () => {
    const harness = mockModules({ indexesFail: true });

    const { response, text, body } = await callSetup("POST");

    expect(response.status).toBe(207);
    expect(body.ok).toBe(false);
    expect(body.status).toBe("partial");
    const steps = Object.fromEntries((body.steps as any[]).map((step) => [step.step, step]));
    expect(steps.firestoreRules.status).toBe("deployed");
    expect(steps.storageRules.status).toBe("deployed");
    expect(steps.indexes.status).toBe("failed");
    expect(steps.indexes.message).toMatch(/Firestore index deployment failed/);

    const saved = harness.saved[0];
    expect(saved.onboardingChecklist.rulesDeployed).toBe(true);
    expect(saved.onboardingChecklist.indexesDeployed).toBe(false);
    expect(saved.onboardingChecklist.storageBucketVerified).toBe(true);
    expect(saved.databaseSetup.lastError).toMatch(/indexes:/);
    expect(harness.audits[0].success).toBe(false);
    expect(text).not.toContain("BEGIN PRIVATE KEY");
  });

  it("returns 500 and skips the remaining steps when the bucket is unreachable", async () => {
    const harness = mockModules({ bucketFails: true });

    const { response, body } = await callSetup("POST");

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.status).toBe("failed");
    const steps = Object.fromEntries((body.steps as any[]).map((step) => [step.step, step]));
    expect(steps.bucket.status).toBe("failed");
    expect(steps.firestoreRules.status).toBe("skipped");
    expect(steps.indexes.status).toBe("skipped");
    expect(harness.deployRules).not.toHaveBeenCalled();
    expect(harness.deployIndexes).not.toHaveBeenCalled();
    expect(harness.saved[0].onboardingChecklist.storageBucketVerified).toBe(false);
    expect(harness.saved[0].databaseSetup.lastError).toMatch(/^bucket:/);
  });

  it("fails clearly when the rule sources cannot be read", async () => {
    const harness = mockModules({ filesUnreadable: true });

    const { response, body } = await callSetup("POST");

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/firestore\.rules could not be read/);
    expect(harness.deployRules).not.toHaveBeenCalled();
    expect(harness.saved).toHaveLength(0);
  });
});

describe("GET /api/super-admin/regions/[id]/database-setup", () => {
  it("returns the stored status without deploying anything", async () => {
    const storedSetup = {
      rulesDeployedAt: "2026-10-27T05:00:00.000Z",
      indexes: { created: 3, existing: 135, pending: 0 },
    };
    const harness = mockModules({
      region: {
        databaseSetup: storedSetup,
        onboardingChecklist: {
          ...BASE_REGION.onboardingChecklist,
          rulesDeployed: true,
          indexesDeployed: true,
          storageBucketVerified: true,
        },
      },
    });

    const { response, text, body } = await callSetup("GET");

    expect(response.status).toBe(200);
    expect(body.regionCode).toBe("TN");
    expect(body.storageBucket).toBe(BUCKET);
    expect(body.hasPersistentConnection).toBe(true);
    expect(body.databaseSetup).toEqual(storedSetup);
    expect(body.checklist).toEqual({
      rulesDeployed: true,
      indexesDeployed: true,
      storageBucketVerified: true,
    });
    expect(harness.deployRules).not.toHaveBeenCalled();
    expect(harness.deployIndexes).not.toHaveBeenCalled();
    expect(harness.saved).toHaveLength(0);
    expect(text).not.toContain("BEGIN PRIVATE KEY");
  });

  it("returns 404 for an unknown region", async () => {
    mockModules({ regionExists: false });

    const { response } = await callSetup("GET");

    expect(response.status).toBe(404);
  });

  it("returns 403 for a non super-admin caller", async () => {
    mockModules({ unauthorized: true });

    const { response } = await callSetup("GET");

    expect(response.status).toBe(403);
  });
});
