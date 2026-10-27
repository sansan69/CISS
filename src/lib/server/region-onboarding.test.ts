import { describe, expect, it } from "vitest";

import {
  MAX_ALLOWED_DOMAINS,
  RegionInputError,
  makeRegionRecord,
  normalizeAllowedDomains,
  parseAndroidGoogleServices,
  stripRegionSecrets,
} from "./region-onboarding";

/**
 * Fake config file. The API key is an obvious placeholder and the project id is
 * fictional — nothing here is a real credential.
 */
const GOOGLE_SERVICES = {
  project_info: {
    project_number: "100000000001",
    project_id: "ciss-tn-example",
    storage_bucket: "ciss-tn-example.firebasestorage.app",
  },
  client: [
    {
      client_info: {
        mobilesdk_app_id: "1:100000000001:android:0000000000000000000000",
        android_client_info: {
          package_name: "in.example.ciss.tn",
        },
      },
      oauth_client: [],
      api_key: [
        { current_key: "AIzaSy-PLACEHOLDER-NOT-A-REAL-KEY-0000" },
      ],
      services: {
        appinvite_service: {
          other_platform_oauth_client: [],
        },
      },
    },
  ],
  configuration_version: "1",
};

function googleServicesText(overrides?: (draft: any) => void) {
  const draft = JSON.parse(JSON.stringify(GOOGLE_SERVICES));
  overrides?.(draft);
  return JSON.stringify(draft);
}

describe("normalizeAllowedDomains", () => {
  it("reduces each entry to a bare lowercase hostname", () => {
    expect(
      normalizeAllowedDomains([
        " HTTPS://CISS-TN.example/portal?state=tn ",
        "ciss-tn.example.",
        "login.ciss-tn.example:443",
      ]),
    ).toEqual([
      "ciss-tn.example",
      "login.ciss-tn.example",
    ]);
  });

  it("accepts a wildcard only as the leading label", () => {
    expect(normalizeAllowedDomains(["*.CISS-TN.example", "ciss-tn.example"])).toEqual([
      "*.ciss-tn.example",
      "ciss-tn.example",
    ]);
  });

  it("splits a newline/comma separated string", () => {
    expect(
      normalizeAllowedDomains("ciss-tn.example\n*.ciss-tn.example,\n\n  Ciss-KL.example  "),
    ).toEqual(["ciss-tn.example", "*.ciss-tn.example", "ciss-kl.example"]);
  });

  it("dedupes entries that normalise to the same host", () => {
    expect(
      normalizeAllowedDomains([
        "ciss-tn.example",
        "CISS-TN.EXAMPLE.",
        "https://ciss-tn.example/",
        "ciss-tn.example:8443",
      ]),
    ).toEqual(["ciss-tn.example"]);
  });

  it("treats absent and empty input as an empty allowlist", () => {
    expect(normalizeAllowedDomains(undefined)).toEqual([]);
    expect(normalizeAllowedDomains(null)).toEqual([]);
    expect(normalizeAllowedDomains("")).toEqual([]);
    expect(normalizeAllowedDomains(["  ", "\n"])).toEqual([]);
  });

  it("allows exactly the maximum number of domains", () => {
    const domains = Array.from(
      { length: MAX_ALLOWED_DOMAINS },
      (_, index) => `state-${index}.example`,
    );
    expect(normalizeAllowedDomains(domains)).toHaveLength(MAX_ALLOWED_DOMAINS);
  });

  it("rejects more than the maximum number of domains", () => {
    const domains = Array.from(
      { length: MAX_ALLOWED_DOMAINS + 1 },
      (_, index) => `state-${index}.example`,
    );
    expect(() => normalizeAllowedDomains(domains)).toThrow(RegionInputError);
    expect(() => normalizeAllowedDomains(domains)).toThrow(
      new RegExp(`At most ${MAX_ALLOWED_DOMAINS}`),
    );
  });

  it.each([
    ["a bare label", "ciss-tn"],
    ["inner whitespace", "ciss tn.example"],
    ["a mid-host wildcard", "ciss-*.example"],
    ["a trailing wildcard", "ciss-tn.*"],
    ["a lone wildcard", "*."],
    ["userinfo", "https://user:pass@ciss-tn.example/"],
    ["an empty host", "https://"],
    ["an underscore", "ciss_tn.example"],
    ["a leading hyphen", "-ciss.example"],
    ["an IPv6 literal", "[::1]"],
  ])("rejects %s", (_label, value) => {
    expect(() => normalizeAllowedDomains([value])).toThrow(RegionInputError);
  });

  it("rejects a non-string entry", () => {
    expect(() =>
      normalizeAllowedDomains([42 as unknown as string]),
    ).toThrow(/must be an array of hostnames/);
  });
});

describe("parseAndroidGoogleServices", () => {
  it("extracts the project, app, API key, and package name", () => {
    expect(parseAndroidGoogleServices(googleServicesText())).toEqual({
      projectId: "ciss-tn-example",
      appId: GOOGLE_SERVICES.client[0].client_info.mobilesdk_app_id,
      apiKey: GOOGLE_SERVICES.client[0].api_key[0].current_key,
      packageName: "in.example.ciss.tn",
    });
  });

  it("ignores everything it does not need", () => {
    const parsed = parseAndroidGoogleServices(googleServicesText());
    expect(Object.keys(parsed).sort()).toEqual(["apiKey", "appId", "packageName", "projectId"]);
  });

  it("selects the Android client named by the caller when the file has several", () => {
    const text = googleServicesText((draft) => {
      const staging = JSON.parse(JSON.stringify(draft.client[0]));
      staging.client_info.mobilesdk_app_id = "1:100000000001:android:1111111111111111111111";
      staging.client_info.android_client_info.package_name = "in.example.ciss.tn.staging";
      staging.api_key = [{ current_key: "AIzaSy-PLACEHOLDER-STAGING-0000" }];
      draft.client.push(staging);
    });

    expect(parseAndroidGoogleServices(text).packageName).toBe("in.example.ciss.tn");
    expect(
      parseAndroidGoogleServices(text, { packageName: "in.example.ciss.tn.staging" }),
    ).toEqual({
      projectId: "ciss-tn-example",
      appId: "1:100000000001:android:1111111111111111111111",
      apiKey: "AIzaSy-PLACEHOLDER-STAGING-0000",
      packageName: "in.example.ciss.tn.staging",
    });
  });

  it("lists the available packages when the requested one is absent", () => {
    expect(() =>
      parseAndroidGoogleServices(googleServicesText(), {
        packageName: "in.example.other.app",
      }),
    ).toThrow(/no Android app for package "in\.example\.other\.app"/);
    expect(() =>
      parseAndroidGoogleServices(googleServicesText(), {
        packageName: "in.example.other.app",
      }),
    ).toThrow(/It contains: in\.example\.ciss\.tn\./);
  });

  it("tolerates a UTF-8 BOM and surrounding whitespace", () => {
    const text = `\uFEFF\n  ${googleServicesText()}\n`;
    expect(parseAndroidGoogleServices(text).projectId).toBe("ciss-tn-example");
  });

  it("rejects empty input", () => {
    expect(() => parseAndroidGoogleServices("   ")).toThrow(/is empty/);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseAndroidGoogleServices("{not json")).toThrow(/not valid JSON/);
  });

  it("rejects a non-object root", () => {
    expect(() => parseAndroidGoogleServices("[1,2,3]")).toThrow(/JSON object/);
  });

  it("requires project_info.project_id", () => {
    expect(() =>
      parseAndroidGoogleServices(
        googleServicesText((draft) => {
          delete draft.project_info;
        }),
      ),
    ).toThrow(/project_info\.project_id/);
  });

  it("requires a client entry", () => {
    expect(() =>
      parseAndroidGoogleServices(
        googleServicesText((draft) => {
          draft.client = [];
        }),
      ),
    ).toThrow(/no client entry/);
  });

  it("requires client_info", () => {
    expect(() =>
      parseAndroidGoogleServices(
        googleServicesText((draft) => {
          delete draft.client[0].client_info;
        }),
      ),
    ).toThrow(/client\[0\]\.client_info/);
  });

  it("requires mobilesdk_app_id", () => {
    expect(() =>
      parseAndroidGoogleServices(
        googleServicesText((draft) => {
          delete draft.client[0].client_info.mobilesdk_app_id;
        }),
      ),
    ).toThrow(/mobilesdk_app_id/);
  });

  it("requires the Android package name", () => {
    // A web-only client (no android_client_info) is the common mistake.
    expect(() =>
      parseAndroidGoogleServices(
        googleServicesText((draft) => {
          delete draft.client[0].client_info.android_client_info;
        }),
      ),
    ).toThrow(/package_name/);
  });

  it("requires an API key", () => {
    expect(() =>
      parseAndroidGoogleServices(
        googleServicesText((draft) => {
          draft.client[0].api_key = [];
        }),
      ),
    ).toThrow(/current_key/);
  });
});

describe("makeRegionRecord", () => {
  const base = {
    regionCode: " tn ",
    regionName: "  Tamil Nadu  ",
    firebaseProjectId: " ciss-tn-example ",
    firebaseApiKey: " web-key ",
    androidAppId: " 1:100:android:abc ",
    androidApiKey: " android-key ",
    androidPackageName: " in.example.ciss.tn ",
    allowedDomains: ["CISS-TN.example.", "ciss-tn.example"],
  };

  it("persists the Android client, host lock, and BYO mode", () => {
    const record = makeRegionRecord({ ...base, hasServiceAccount: true });

    expect(record.regionCode).toBe("TN");
    expect(record.regionName).toBe("Tamil Nadu");
    expect(record.firebaseProjectId).toBe("ciss-tn-example");
    expect(record.androidAppId).toBe("1:100:android:abc");
    expect(record.androidApiKey).toBe("android-key");
    expect(record.androidPackageName).toBe("in.example.ciss.tn");
    expect(record.allowedDomains).toEqual(["ciss-tn.example"]);
    expect(record.onboardingMode).toBe("byo_firebase");
    expect(record.status).toBe("config_pending");
    expect(record.onboardingChecklist.metadataSaved).toBe(true);
    expect(record.onboardingChecklist.firebaseValidated).toBe(false);
  });

  it("defaults to automated onboarding when no service account is supplied", () => {
    const record = makeRegionRecord({ ...base, hasServiceAccount: false });
    expect(record.onboardingMode).toBe("automated");
  });

  it("defaults to automated onboarding when the flag is omitted", () => {
    const record = makeRegionRecord(base);
    expect(record.onboardingMode).toBe("automated");
  });

  it("honours an explicit onboarding mode", () => {
    const record = makeRegionRecord({
      ...base,
      hasServiceAccount: true,
      onboardingMode: "automated",
    });
    expect(record.onboardingMode).toBe("automated");
  });

  it("nulls the optional fields it was not given", () => {
    const record = makeRegionRecord({
      regionCode: "KL",
      regionName: "Kerala",
      firebaseProjectId: "ciss-kl-example",
    });
    expect(record.androidAppId).toBeNull();
    expect(record.androidApiKey).toBeNull();
    expect(record.androidPackageName).toBeNull();
    expect(record.allowedDomains).toEqual([]);
  });

  it("requires the identifying fields", () => {
    expect(() =>
      makeRegionRecord({ regionCode: " ", regionName: "X", firebaseProjectId: "y" }),
    ).toThrow(/regionCode is required/);
    expect(() =>
      makeRegionRecord({ regionCode: "TN", regionName: " ", firebaseProjectId: "y" }),
    ).toThrow(/regionName is required/);
    expect(() =>
      makeRegionRecord({ regionCode: "TN", regionName: "X", firebaseProjectId: " " }),
    ).toThrow(/firebaseProjectId is required/);
  });

  it("rejects an unknown onboarding mode", () => {
    expect(() =>
      makeRegionRecord({
        ...base,
        onboardingMode: "carrier-pigeon" as never,
      }),
    ).toThrow(/onboardingMode must be/);
  });
});

describe("stripRegionSecrets", () => {
  it("drops credential-shaped fields and keeps the rest", () => {
    const stripped = stripRegionSecrets({
      regionCode: "TN",
      firebaseProjectId: "ciss-tn-example",
      serviceAccountJson: '{"private_key":"secret"}',
      serviceAccountBase64: "c2VjcmV0",
      encryptedServiceAccount: { cipherText: "secret" },
      privateKey: "secret",
      clientEmail: "region-admin@ciss-tn-example.iam.gserviceaccount.com",
    });

    expect(stripped).toEqual({
      regionCode: "TN",
      firebaseProjectId: "ciss-tn-example",
    });
  });
});
