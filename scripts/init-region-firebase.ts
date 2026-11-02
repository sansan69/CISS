/**
 * Initialise the Google-side services a BYO Firebase project needs before the
 * CISS platform can use it: Firebase itself, Firestore (native, asia-south1),
 * Identity Platform with email/password, and the default Storage bucket.
 *
 * This uses the region's own service account, so it works for a project that
 * the operator's Google account is not a member of.
 *
 * Dry-run by default. Pass `--apply` to create.
 *
 *   npx tsx scripts/init-region-firebase.ts \
 *     --project ciss-tcs --credentials ~/Downloads/ciss-tcs-key.json \
 *     --bucket ciss-tcs.firebasestorage.app --location asia-south1
 */
import fs from "node:fs/promises";
import { JWT } from "google-auth-library";

type Options = Record<string, string | boolean>;

function parseArgs(argv: string[]): Options {
  const out: Options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function required(options: Options, key: string): string {
  const value = options[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`--${key} is required`);
  return value.trim();
}

const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/firebase",
];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectId = required(options, "project");
  const credentialsPath = required(options, "credentials").replace(/^~/, process.env.HOME ?? "~");
  const bucket = (options.bucket as string) || `${projectId}.firebasestorage.app`;
  const location = (options.location as string) || "asia-south1";
  const apply = options.apply === true;
  const dryRunOnly = options["dry-run-only"] === true;

  const serviceAccount = JSON.parse(await fs.readFile(credentialsPath, "utf8"));
  if (serviceAccount.project_id !== projectId) {
    throw new Error(`Service account is for ${serviceAccount.project_id}, expected ${projectId}`);
  }

  const client = new JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: SCOPES,
  });
  await client.authorize();
  const token = (await client.getAccessToken()).token;
  if (!token) throw new Error("Could not mint an access token");

  const call = async (
    method: string,
    url: string,
    body?: unknown,
    acceptStatuses: number[] = [],
  ) => {
    const response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    if (!response.ok && !acceptStatuses.includes(response.status)) {
      throw new Error(`${method} ${url} -> ${response.status} ${text.slice(0, 400)}`);
    }
    return { status: response.status, payload } as const;
  };

  console.log(`Project : ${projectId}`);
  console.log(`Bucket  : ${bucket}`);
  console.log(`Location: ${location}`);
  console.log(`Mode    : ${apply && !dryRunOnly ? "APPLY" : "dry-run"}`);

  // 1. Firebase (idempotent; returns 403/409 when already configured).
  console.log("\n1. Firebase project link ...");
  const firebaseState = await call(
    "POST",
    `https://firebase.googleapis.com/v1beta1/projects/${projectId}:addFirebase`,
    {},
    [400, 403, 409],
  );
  console.log(`   addFirebase -> ${firebaseState.status}`);

  // 2. APIs the platform depends on.
  const apis = [
    "firestore.googleapis.com",
    "identitytoolkit.googleapis.com",
    "storage.googleapis.com",
    "firebasestorage.googleapis.com",
    "firebaserules.googleapis.com",
    "cloudfunctions.googleapis.com",
  ];
  console.log("\n2. Enabling APIs ...");
  for (const api of apis) {
    if (!apply || dryRunOnly) {
      console.log(`   would enable ${api}`);
      continue;
    }
    const result = await call(
      "POST",
      `https://serviceusage.googleapis.com/v1/projects/${projectId}/services/${api}:enable`,
      {},
      [409],
    );
    console.log(`   ${api} -> ${result.status}`);
  }

  // 3. Firestore database.
  console.log("\n3. Firestore (default) ...");
  const databases = await call(
    "GET",
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases`,
    undefined,
    [403, 404],
  );
  const existing = (databases.payload as any)?.databases ?? [];
  const hasDefault = existing.some((db: any) => db.name?.endsWith("/databases/(default)"));
  console.log(`   existing databases: ${existing.length}${hasDefault ? " (default present)" : ""}`);
  if (!hasDefault) {
    if (!apply || dryRunOnly) {
      console.log("   would create (default) in " + location);
    } else {
      const created = await call(
        "POST",
        `https://firestore.googleapis.com/v1/projects/${projectId}/databases?databaseId=(default)`,
        { name: `projects/${projectId}/databases/(default)`, locationId: location, type: "FIRESTORE_NATIVE" },
        [409],
      );
      console.log(`   create database -> ${created.status}`);
    }
  }

  // 4. Identity Platform with email/password.
  console.log("\n4. Identity Platform / email-password ...");
  const identity = await call(
    "GET",
    `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`,
    undefined,
    [403, 404],
  );
  const signIn = (identity.payload as any)?.signIn ?? {};
  console.log(`   email password enabled: ${String(signIn.email?.enabled ?? false)}`);
  if (!apply || dryRunOnly) {
    console.log("   would enable email/password sign-in");
  } else {
    const updated = await call(
      "PATCH",
      `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config?updateMask=signIn.email`,
      { signIn: { email: { enabled: true, passwordRequired: true } } },
      [400],
    );
    console.log(`   config -> ${updated.status}`);
  }

  // 5. Default Storage bucket.
  console.log("\n5. Storage bucket ...");
  const bucketState = await call(
    "GET",
    `https://storage.googleapis.com/storage/v1/b/${bucket}`,
    undefined,
    [403, 404],
  );
  console.log(`   bucket lookup -> ${bucketState.status}`);
  if (bucketState.status === 404) {
    if (!apply || dryRunOnly) {
      console.log(`   would create gs://${bucket} in ${location.slice(0, -1)}`);
    } else {
      const created = await call(
        "POST",
        `https://storage.googleapis.com/storage/v1/b?project=${projectId}`,
        {
          name: bucket,
          location: location.toUpperCase(),
          storageClass: "STANDARD",
          iamConfiguration: { uniformBucketLevelAccess: { enabled: true } },
        },
        [409],
      );
      console.log(`   create bucket -> ${created.status}`);
    }
  }

  console.log("\nDone. Re-run: npx tsx scripts/onboard-region.ts ... --apply --rules --indexes --seed");
}

main().catch((error) => {
  console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
