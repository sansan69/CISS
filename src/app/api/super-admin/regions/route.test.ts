import { afterEach, describe, expect, it, vi } from "vitest";

const PROJECT_ID = "ciss-tn-example";
const ANDROID_PACKAGE = "in.example.ciss.tn";
const ANDROID_APP_ID = "1:100000000001:android:0000000000000000000000";
const ANDROID_API_KEY = "AIzaSy-PLACEHOLDER-NOT-A-REAL-KEY-0000";

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

const GOOGLE_SERVICES = {
  project_info: {
    project_number: "100000000001",
    project_id: PROJECT_ID,
    storage_bucket: `${PROJECT_ID}.firebasestorage.app`,
  },
  client: [
    {
      client_info: {
        mobilesdk_app_id: ANDROID_APP_ID,
        android_client_info: { package_name: ANDROID_PACKAGE },
      },
      api_key: [{ current_key: ANDROID_API_KEY }],
    },
  ],
  configuration_version: "1",
};

const OK_CHECKS = {
  projectIdMatches: true,
  firestoreReachable: true,
  authReachable: true,
  storageReachable: true,
};

type Harness = {
  saved: Record<string, any>[];
  audits: Record<string, any>[];
  saveConnection: ReturnType<typeof vi.fn>;
  validate: ReturnType<typeof vi.fn>;
};

function mockModules(options: {
  existing?: boolean;
  validation?: Record<string, any>;
} = {}): Harness {
  const saved: Record<string, any>[] = [];
  const audits: Record<string, any>[] = [];

  const validate = vi.fn(
    async () =>
      options.validation ?? { success: true, checks: OK_CHECKS, messages: ["Firestore connection verified."] },
  );
  const saveConnection = vi.fn(async () => true);

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
          get: vi.fn(async () => ({ exists: Boolean(options.existing) })),
          set: vi.fn(async (doc: Record<string, any>) => {
            saved.push(doc);
          }),
        })),
      };
    }),
  };

  vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
  vi.doMock("@/lib/server/auth", () => ({
    requireSuperAdmin: vi.fn(async () => ({
      uid: "super-admin-1",
      email: "super@example.test",
      role: "superAdmin",
    })),
    unauthorizedResponse: (message: string, status: number) =>
      new Response(JSON.stringify({ error: message }), { status }),
  }));
  vi.doMock("@/lib/server/region-connections", () => ({ saveRegionConnection: saveConnection }));

  // Keep the real normalization/parsing/record helpers; only the network-hitting
  // validation call is stubbed.
  vi.doMock("@/lib/server/region-onboarding", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/server/region-onboarding")>();
    return { ...actual, validateRegionFirebaseConnection: validate };
  });

  return { saved, audits, saveConnection, validate };
}

async function postRegion(body: Record<string, unknown>) {
  const { POST } = await import("./route");
  const response = await POST(
    new Request("https://example.test/api/super-admin/regions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const text = await response.text();
  return { response, text, body: text ? JSON.parse(text) : null };
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    regionCode: "tn",
    regionName: "Tamil Nadu",
    firebaseProjectId: PROJECT_ID,
    firebaseApiKey: "web-api-key-placeholder",
    firebaseWebAppId: "1:100000000001:web:0000000000000000000000",
    storageBucket: `${PROJECT_ID}.firebasestorage.app`,
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
    regionAdminEmail: "admin@tn.example",
    ...overrides,
  };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("POST /api/super-admin/regions — BYO Firebase onboarding", () => {
  it("enrolls a state with google-services.json and an encrypted service-account save", async () => {
    const harness = mockModules();

    const { response, text, body } = await postRegion(
      baseBody({
        serviceAccountJson: JSON.stringify(SERVICE_ACCOUNT),
        googleServicesJson: JSON.stringify(GOOGLE_SERVICES),
        allowedDomains: `CISS-TN.example\n*.CISS-TN.example, ciss-tn.example`,
      }),
    );

    expect(response.status).toBe(201);
    expect(body.id).toBe("TN");
    expect(body.firebaseValidated).toBe(true);
    expect(body.hasPersistentConnection).toBe(true);

    const region = body.region;
    expect(region.regionCode).toBe("TN");
    expect(region.status).toBe("validated");
    expect(region.onboardingMode).toBe("byo_firebase");
    expect(region.onboardingChecklist.firebaseValidated).toBe(true);
    expect(region.persistentConnectionReady).toBe(true);
    expect(region.allowedDomains).toEqual(["ciss-tn.example", "*.ciss-tn.example"]);
    expect(region.androidAppId).toBe(ANDROID_APP_ID);
    expect(region.androidApiKey).toBe(ANDROID_API_KEY);
    expect(region.androidPackageName).toBe(ANDROID_PACKAGE);

    // The connection is persisted encrypted, through saveRegionConnection only.
    expect(harness.saveConnection).toHaveBeenCalledTimes(1);
    const [savedDb, saveInput, actor] = harness.saveConnection.mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(savedDb).toBeTruthy();
    expect(saveInput.regionCode).toBe("TN");
    expect(saveInput.firebaseProjectId).toBe(PROJECT_ID);
    expect(typeof saveInput.serviceAccountJson).toBe("string");
    expect(actor.uid).toBe("super-admin-1");

    // The region document never carries the key material.
    expect(harness.saved).toHaveLength(1);
    const savedRegion = harness.saved[0];
    expect(savedRegion.status).toBe("validated");
    expect(savedRegion).not.toHaveProperty("serviceAccountJson");
    expect(savedRegion).not.toHaveProperty("serviceAccountBase64");
    expect(savedRegion).not.toHaveProperty("privateKey");
    expect(JSON.stringify(savedRegion)).not.toContain("BEGIN PRIVATE KEY");
    expect(JSON.stringify(savedRegion)).not.toContain(SERVICE_ACCOUNT.client_email);

    // The response never carries the key material either.
    expect(text).not.toContain("BEGIN PRIVATE KEY");
    expect(text).not.toContain(SERVICE_ACCOUNT.client_email);
    expect(text).not.toContain(SERVICE_ACCOUNT.private_key_id);

    // The audit trail records the decision, not the secret.
    expect(harness.audits).toHaveLength(1);
    const audit = harness.audits[0];
    expect(audit.action).toBe("region_created");
    expect(audit.firebaseValidated).toBe(true);
    expect(audit.onboardingMode).toBe("byo_firebase");
    expect(JSON.stringify(audit)).not.toContain("BEGIN PRIVATE KEY");
    expect(JSON.stringify(audit)).not.toContain(SERVICE_ACCOUNT.client_email);
  });

  it("accepts explicit Android values without google-services.json", async () => {
    const harness = mockModules();

    const { response, body } = await postRegion(
      baseBody({
        serviceAccountJson: JSON.stringify(SERVICE_ACCOUNT),
        androidAppId: ANDROID_APP_ID,
        androidApiKey: ANDROID_API_KEY,
        androidPackageName: ANDROID_PACKAGE,
      }),
    );

    expect(response.status).toBe(201);
    expect(body.region.androidPackageName).toBe(ANDROID_PACKAGE);
    expect(body.firebaseValidated).toBe(true);
    expect(harness.saved[0].androidPackageName).toBe(ANDROID_PACKAGE);
  });

  it("requires a Storage bucket when enrolling a BYO Firebase project", async () => {
    const harness = mockModules();

    const body = baseBody({ serviceAccountJson: JSON.stringify(SERVICE_ACCOUNT) });
    delete (body as Record<string, unknown>).storageBucket;
    const { response, body: parsed } = await postRegion(body);

    expect(response.status).toBe(422);
    expect(parsed.error).toMatch(/storageBucket is required/i);
    expect(harness.validate).not.toHaveBeenCalled();
    expect(harness.saveConnection).not.toHaveBeenCalled();
    expect(harness.saved).toHaveLength(0);
  });

  it("rejects a storage value that is not a bucket name", async () => {
    const harness = mockModules();

    const { response, body } = await postRegion(
      baseBody({
        serviceAccountJson: JSON.stringify(SERVICE_ACCOUNT),
        storageBucket: "https://console.firebase.google.com/project/ciss-tn-example/storage",
      }),
    );

    expect(response.status).toBe(422);
    expect(body.error).toMatch(/not a valid Cloud Storage bucket name/i);
    expect(harness.saved).toHaveLength(0);
  });

  it("normalises a gs:// bucket to its bare name", async () => {
    const harness = mockModules();

    const { response, body } = await postRegion(
      baseBody({
        serviceAccountJson: JSON.stringify(SERVICE_ACCOUNT),
        storageBucket: "gs://ciss-tn-bucket/",
      }),
    );

    expect(response.status).toBe(201);
    expect(body.region.storageBucket).toBe("ciss-tn-bucket");
    expect(harness.saved[0].storageBucket).toBe("ciss-tn-bucket");
  });

  it("accepts a base64 service account and still keeps it out of the response", async () => {
    const harness = mockModules();
    const base64 = Buffer.from(JSON.stringify(SERVICE_ACCOUNT), "utf-8").toString("base64");

    const { response, text, body } = await postRegion(
      baseBody({ serviceAccountBase64: base64 }),
    );

    expect(response.status).toBe(201);
    expect(harness.validate).toHaveBeenCalledTimes(1);
    const validateInput = harness.validate.mock.calls[0][0] as Record<string, unknown>;
    expect(validateInput.serviceAccountBase64).toBe(base64);
    expect(validateInput.serviceAccountJson).toBeUndefined();

    expect(harness.saveConnection).toHaveBeenCalledTimes(1);
    const saveInput = harness.saveConnection.mock.calls[0][1] as Record<string, unknown>;
    expect(saveInput.serviceAccountBase64).toBe(base64);

    expect(body.region).not.toHaveProperty("serviceAccountBase64");
    expect(text).not.toContain("BEGIN PRIVATE KEY");
    expect(text).not.toContain(SERVICE_ACCOUNT.client_email);
  });

  it("enrolls a metadata-only region without a service account", async () => {
    const harness = mockModules();

    const { response, body } = await postRegion(baseBody());

    expect(response.status).toBe(201);
    expect(body.region.onboardingMode).toBe("automated");
    expect(body.region.status).toBe("config_pending");
    expect(body.firebaseValidated).toBe(false);
    expect(body.hasPersistentConnection).toBe(false);
    expect(harness.validate).not.toHaveBeenCalled();
    expect(harness.saveConnection).not.toHaveBeenCalled();
    expect(harness.saved).toHaveLength(1);
  });

  it("rejects a google-services.json from a different Firebase project", async () => {
    const harness = mockModules();
    const otherProject = JSON.parse(JSON.stringify(GOOGLE_SERVICES));
    otherProject.project_info.project_id = "someone-elses-project";

    const { response, body } = await postRegion(
      baseBody({
        serviceAccountJson: JSON.stringify(SERVICE_ACCOUNT),
        googleServicesJson: JSON.stringify(otherProject),
      }),
    );

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/belongs to Firebase project "someone-elses-project"/);
    expect(harness.validate).not.toHaveBeenCalled();
    expect(harness.saveConnection).not.toHaveBeenCalled();
    expect(harness.saved).toHaveLength(0);
  });

  it("rejects a service account from a different Firebase project", async () => {
    const harness = mockModules();
    const otherAccount = { ...SERVICE_ACCOUNT, project_id: "someone-elses-project" };

    const { response, body } = await postRegion(
      baseBody({ serviceAccountJson: JSON.stringify(otherAccount) }),
    );

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/The service account belongs to Firebase project/);
    expect(harness.validate).not.toHaveBeenCalled();
    expect(harness.saveConnection).not.toHaveBeenCalled();
    expect(harness.saved).toHaveLength(0);
  });

  it("rejects an explicit Android package that is not in google-services.json", async () => {
    const harness = mockModules();

    const { response, body } = await postRegion(
      baseBody({
        googleServicesJson: JSON.stringify(GOOGLE_SERVICES),
        androidPackageName: "in.example.other.app",
      }),
    );

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/no Android app for package "in\.example\.other\.app"/);
    expect(harness.saved).toHaveLength(0);
  });

  it("rejects conflicting explicit Android values against google-services.json", async () => {
    const harness = mockModules();

    const { response, body } = await postRegion(
      baseBody({
        googleServicesJson: JSON.stringify(GOOGLE_SERVICES),
        androidAppId: "1:100000000001:android:9999999999999999999999",
      }),
    );

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/androidAppId does not match/);
    expect(harness.saved).toHaveLength(0);
  });

  it("keeps config_pending and persists no secret when Firebase validation fails", async () => {
    const harness = mockModules({
      validation: {
        success: false,
        checks: { ...OK_CHECKS, firestoreReachable: false },
        messages: ["Firestore is not ready yet. Open Firebase Console > Firestore Database."],
      },
    });

    const { response, text, body } = await postRegion(
      baseBody({ serviceAccountJson: JSON.stringify(SERVICE_ACCOUNT) }),
    );

    expect(response.status).toBe(422);
    expect(body.error).toMatch(/validation failed/i);
    expect(body.checks.firestoreReachable).toBe(false);
    expect(body.messages[0]).toMatch(/Firestore is not ready/);

    // Nothing secret was persisted or echoed.
    expect(harness.saveConnection).not.toHaveBeenCalled();
    expect(harness.saved[0].status).toBe("config_pending");
    expect(harness.saved[0].onboardingChecklist.firebaseValidated).toBe(false);
    expect(harness.saved[0]).not.toHaveProperty("serviceAccountJson");
    expect(harness.saved[0].persistentConnectionReady).toBeUndefined();
    expect(text).not.toContain("BEGIN PRIVATE KEY");
    expect(text).not.toContain(SERVICE_ACCOUNT.client_email);
  });

  it("maps an unparseable service account to a 400", async () => {
    const harness = mockModules();

    const { response, body } = await postRegion(
      baseBody({ serviceAccountJson: "{not-json" }),
    );

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/could not be parsed/);
    expect(harness.saveConnection).not.toHaveBeenCalled();
    expect(harness.saved).toHaveLength(0);
  });

  it("rejects a malformed google-services.json", async () => {
    const harness = mockModules();

    const { response, body } = await postRegion(
      baseBody({ googleServicesJson: "{not-json" }),
    );

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/not valid JSON/);
    expect(harness.saved).toHaveLength(0);
  });

  it("rejects invalid allowed domains without writing the region", async () => {
    const harness = mockModules();

    const { response, body } = await postRegion(
      baseBody({ allowedDomains: ["ciss-tn", "*.example.com"] }),
    );

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/Invalid allowed domain "ciss-tn"/);
    expect(harness.saved).toHaveLength(0);
  });

  it("rejects an unknown onboarding mode", async () => {
    const harness = mockModules();

    const { response, body } = await postRegion(
      baseBody({ onboardingMode: "carrier-pigeon" }),
    );

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/onboardingMode must be/);
    expect(harness.saved).toHaveLength(0);
  });

  it("returns 409 for an existing region without validating anything", async () => {
    const harness = mockModules({ existing: true });

    const { response, body } = await postRegion(
      baseBody({ serviceAccountJson: JSON.stringify(SERVICE_ACCOUNT) }),
    );

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/already exists/);
    expect(harness.validate).not.toHaveBeenCalled();
    expect(harness.saveConnection).not.toHaveBeenCalled();
    expect(harness.saved).toHaveLength(0);
  });

  it("requires the identifying fields", async () => {
    const harness = mockModules();

    const { response, body } = await postRegion({ regionName: "Tamil Nadu" });

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/regionCode, regionName, and firebaseProjectId are required/);
    expect(harness.saved).toHaveLength(0);
  });
});

describe("GET /api/super-admin/regions/[id]/deployment-config", () => {
  it("returns the BYO Android/domain config and never the service account", async () => {
    // The route serves the deployment's own region from env; pick a code that is
    // guaranteed to go through the stored-document branch under any environment.
    const { REGION_CODE } = await import("@/lib/runtime-config");
    const regionCode = REGION_CODE === "TN" ? "KA" : "TN";

    const regionDoc: Record<string, any> = {
      regionCode,
      regionName: "Example State",
      status: "validated",
      firebaseProjectId: PROJECT_ID,
      firebaseApiKey: "web-api-key-placeholder",
      firebaseWebAppId: "1:100000000001:web:0000000000000000000000",
      storageBucket: `${PROJECT_ID}.firebasestorage.app`,
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      messagingSenderId: "100000000001",
      measurementId: null,
      androidAppId: ANDROID_APP_ID,
      androidApiKey: ANDROID_API_KEY,
      androidPackageName: ANDROID_PACKAGE,
      allowedDomains: ["ciss-tn.example", "*.ciss-tn.example"],
      onboardingMode: "byo_firebase",
      onboardingChecklist: {
        metadataSaved: true,
        firebaseValidated: true,
        defaultsSeeded: false,
        regionAdminCreated: false,
        vercelConfigured: false,
      },
      // Planted deliberately: a hand-written document must never leak these.
      serviceAccountJson: JSON.stringify(SERVICE_ACCOUNT),
      encryptedServiceAccount: { cipherText: "must-not-leak" },
    };

    const db = {
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          get: vi.fn(async () => ({
            exists: true,
            id: regionCode,
            data: () => regionDoc,
          })),
        })),
      })),
    };

    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    vi.doMock("@/lib/server/auth", () => ({
      requireSuperAdmin: vi.fn(async () => ({ uid: "super-admin-1", role: "superAdmin" })),
      unauthorizedResponse: (message: string, status: number) =>
        new Response(JSON.stringify({ error: message }), { status }),
    }));
    vi.doMock("@/lib/server/region-connections", () => ({
      getRegionConnection: vi.fn(async () => null),
    }));

    const { GET } = await import("./[id]/deployment-config/route");
    const response = await GET(
      new Request(`https://example.test/api/super-admin/regions/${regionCode}/deployment-config`),
      { params: Promise.resolve({ id: regionCode }) },
    );
    const text = await response.text();
    const body = JSON.parse(text);

    expect(response.status).toBe(200);
    expect(body.deploymentConfig).toMatchObject({
      REGION_CODE: regionCode,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT_ID,
      NEXT_PUBLIC_FIREBASE_ANDROID_APP_ID: ANDROID_APP_ID,
      NEXT_PUBLIC_FIREBASE_ANDROID_API_KEY: ANDROID_API_KEY,
      NEXT_PUBLIC_FIREBASE_ANDROID_PACKAGE_NAME: ANDROID_PACKAGE,
      REGION_ALLOWED_DOMAINS: "ciss-tn.example,*.ciss-tn.example",
      ONBOARDING_MODE: "byo_firebase",
    });
    expect(body.hasPersistentConnection).toBe(false);

    expect(body.region).not.toHaveProperty("serviceAccountJson");
    expect(body.region).not.toHaveProperty("encryptedServiceAccount");
    expect(text).not.toContain("BEGIN PRIVATE KEY");
    expect(text).not.toContain(SERVICE_ACCOUNT.client_email);
    expect(text).not.toContain("must-not-leak");
  });

  it("defaults the onboarding mode and empty domain list for a hand-enrolled region", async () => {
    const { REGION_CODE } = await import("@/lib/runtime-config");
    const regionCode = REGION_CODE === "KA" ? "TN" : "KA";

    const db = {
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          get: vi.fn(async () => ({
            exists: true,
            id: regionCode,
            data: () => ({
              regionCode,
              regionName: "Example State",
              status: "config_pending",
              firebaseProjectId: PROJECT_ID,
              onboardingChecklist: {
                metadataSaved: true,
                firebaseValidated: false,
                defaultsSeeded: false,
                regionAdminCreated: false,
                vercelConfigured: false,
              },
            }),
          })),
        })),
      })),
    };

    vi.doMock("@/lib/firebaseAdmin", () => ({ db }));
    vi.doMock("@/lib/server/auth", () => ({
      requireSuperAdmin: vi.fn(async () => ({ uid: "super-admin-1", role: "superAdmin" })),
      unauthorizedResponse: (message: string, status: number) =>
        new Response(JSON.stringify({ error: message }), { status }),
    }));
    vi.doMock("@/lib/server/region-connections", () => ({
      getRegionConnection: vi.fn(async () => null),
    }));

    const { GET } = await import("./[id]/deployment-config/route");
    const response = await GET(
      new Request(`https://example.test/api/super-admin/regions/${regionCode}/deployment-config`),
      { params: Promise.resolve({ id: regionCode }) },
    );
    const body = await response.json();

    expect(body.deploymentConfig).toMatchObject({
      ONBOARDING_MODE: "automated",
      REGION_ALLOWED_DOMAINS: "",
      NEXT_PUBLIC_FIREBASE_ANDROID_APP_ID: "",
      NEXT_PUBLIC_FIREBASE_ANDROID_PACKAGE_NAME: "",
    });
  });
});
