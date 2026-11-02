/**
 * Provision one regional Firebase project for the CISS platform.
 *
 * Dry-run by default: validates the service account against the project and
 * reports what would change. Pass `--apply` to write.
 *
 *   npx tsx scripts/onboard-region.ts \
 *     --project ciss-tcs --credentials ~/Downloads/key.json \
 *     --region-code TN --region-name "Tamil Nadu"
 *
 * Optional with --apply:
 *   --rules        release firestore.rules + storage.rules
 *   --indexes      create missing composite indexes from firestore.indexes.json
 *   --seed         write systemConfig/runtime, enrollmentFormConfig/global,
 *                  regionSetupProgress/default
 *   --admin-email <email> --admin-password <password>   create the regional admin
 *
 * Nothing is deleted. Re-running is safe: rules are re-released, indexes are
 * matched by signature, seed documents are merged, and an existing admin is
 * updated rather than recreated.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  deployFirestoreRules,
  deployStorageRules,
  deployFirestoreIndexes,
  listFirestoreIndexes,
} from "../src/lib/server/firebase-management-client";
import {
  createRegionAdminAccount,
  seedRegionDefaults,
  validateRegionFirebaseConnection,
} from "../src/lib/server/region-onboarding";

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

function requireString(options: Options, key: string): string {
  const value = options[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`--${key} is required`);
  }
  return value.trim();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectId = requireString(options, "project");
  const credentialsPath = requireString(options, "credentials").replace(/^~/, process.env.HOME ?? "~");
  const regionCode = requireString(options, "region-code").toUpperCase();
  const regionName = requireString(options, "region-name");
  const apply = options.apply === true;

  const raw = await fs.readFile(credentialsPath, "utf8");
  const serviceAccountJson = JSON.stringify(JSON.parse(raw));
  const parsed = JSON.parse(raw) as { project_id?: string; client_email?: string };
  if (parsed.project_id !== projectId) {
    throw new Error(
      `Service account belongs to ${parsed.project_id ?? "unknown"}, expected ${projectId}`,
    );
  }

  console.log(`Region      : ${regionCode} (${regionName})`);
  console.log(`Project     : ${projectId}`);
  console.log(`Service acct: ${parsed.client_email}`);
  console.log(`Mode        : ${apply ? "APPLY" : "dry-run"}`);

  const credentials = { firebaseProjectId: projectId, serviceAccountJson };

  console.log("\nValidating Firestore / Auth / Storage with the region credentials ...");
  const validation = await validateRegionFirebaseConnection(credentials);
  console.log(`  checks: ${JSON.stringify(validation.checks)}`);
  if (validation.messages.length) {
    console.log(`  messages: ${validation.messages.join(" | ")}`);
  }
  const allReachable =
    validation.checks.projectIdMatches &&
    validation.checks.firestoreReachable &&
    validation.checks.authReachable;
  if (!allReachable) {
    throw new Error("Region credentials failed validation; nothing was written.");
  }

  const root = path.resolve(__dirname, "..");
  const firestoreRules = await fs.readFile(path.join(root, "firestore.rules"), "utf8");
  const storageRules = await fs.readFile(path.join(root, "storage.rules"), "utf8");
  const indexesFile = JSON.parse(
    await fs.readFile(path.join(root, "firestore.indexes.json"), "utf8"),
  ) as { indexes?: unknown[] };

  console.log(`\nAssets: firestore.rules ${firestoreRules.length} chars, storage.rules ${storageRules.length} chars, ${indexesFile.indexes?.length ?? 0} indexes`);

  if (!apply) {
    const existing = await listFirestoreIndexes(projectId, serviceAccountJson);
    console.log(`  existing indexes in project: ${existing.length}`);
    console.log("\nDry run complete. Re-run with --apply --rules --indexes --seed to provision.");
    return;
  }

  if (options.rules === true) {
    console.log("\nReleasing Firestore rules ...");
    await deployFirestoreRules(projectId, firestoreRules, serviceAccountJson);
    console.log("  firestore rules released");
    console.log("Releasing Storage rules ...");
    await deployStorageRules(projectId, storageRules, serviceAccountJson);
    console.log("  storage rules released");
  }

  if (options.indexes === true) {
    console.log("\nCreating missing composite indexes (this can take several minutes) ...");
    const result = await deployFirestoreIndexes(projectId, {
      indexesFile: JSON.stringify(indexesFile),
      serviceAccountJson,
      maxWaitMs: 120_000,
    });
    console.log(`  ${JSON.stringify(result)}`);
  }

  if (options.seed === true) {
    console.log("\nSeeding regional defaults ...");
    const seeded = await seedRegionDefaults(
      credentials,
      { regionCode, regionName, firebaseProjectId: projectId },
      { uid: "onboard-region-script", email: "script@cisskerala.app" },
    );
    console.log(`  seeded: ${seeded.seededDocs.join(", ")}`);
  }

  if (options["admin-email"]) {
    const email = requireString(options, "admin-email");
    const password = requireString(options, "admin-password");
    console.log(`\nCreating regional admin ${email} ...`);
    const result = await createRegionAdminAccount(
      credentials,
      { regionCode, regionName },
      { email, password, displayName: `${regionName} Administrator` },
    );
    console.log(`  uid=${result.uid} created=${result.created}`);
  }

  console.log("\nDone.");
}

main().catch((error) => {
  console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
