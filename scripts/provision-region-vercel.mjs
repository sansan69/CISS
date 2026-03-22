#!/usr/bin/env node

import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

const REPO_ROOT = process.cwd();
const TEAM_SLUG = process.env.VERCEL_REGION_TEAM_SLUG || "sansan69s-projects";
const SOURCE_PROJECT = process.env.VERCEL_SOURCE_PROJECT || "ciss";
const HQ_BASE_URL = process.env.HQ_BASE_URL || "https://cisskerala.site";
const HQ_BYPASS_SECRET = process.env.HQ_VERCEL_PROTECTION_BYPASS_SECRET || "";
const EXCLUDED_REGION_ENV_KEYS = new Set([
  "APP_MODE",
  "NEXT_PUBLIC_APP_MODE",
  "REGION_CODE",
  "NEXT_PUBLIC_REGION_CODE",
  "REGION_NAME",
  "NEXT_PUBLIC_REGION_NAME",
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
  "NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID",
  "FIREBASE_ADMIN_SDK_CONFIG_BASE64",
  "FIREBASE_ADMIN_SDK_CONFIG",
  "FIREBASE_ADMIN_PROJECT_ID",
  "FIREBASE_ADMIN_CLIENT_EMAIL",
  "FIREBASE_ADMIN_PRIVATE_KEY",
]);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (part.startsWith("--")) {
      const key = part.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      args._.push(part);
    }
  }
  return args;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

function slugifyRegionName(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function buildProjectName(regionName, regionCode) {
  const regionSlug = slugifyRegionName(regionName || "");
  const codeSlug = slugifyRegionName(regionCode || "");
  const base = regionSlug ? `ciss-${regionSlug}` : `ciss-${codeSlug || "region"}`;
  return base.slice(0, 80).replace(/-+$/g, "");
}

function buildProjectUrl(projectName) {
  return `https://vercel.com/${TEAM_SLUG}/${projectName}`;
}

function buildProductionUrl(projectName) {
  return `https://${projectName}.vercel.app`;
}

function buildTeamProductionUrl(projectName) {
  return `https://${projectName}-${TEAM_SLUG}.vercel.app`;
}

function extractDeploymentUrl(output, projectName) {
  const aliasedMatch = output.match(/Aliased:\s+(https:\/\/[^\s]+)/);
  if (aliasedMatch?.[1]) {
    return aliasedMatch[1];
  }

  const productionMatch = output.match(/Production:\s+(https:\/\/[^\s]+)/);
  if (productionMatch?.[1]) {
    return productionMatch[1];
  }

  return buildProductionUrl(projectName);
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || REPO_ROOT,
    stdio: options.capture ? ["pipe", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    env: { ...process.env, ...(options.env || {}) },
  });

  if (result.status !== 0) {
    const stderr = result.stderr || "";
    const stdout = result.stdout || "";
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}\n${stderr || stdout}`.trim(),
    );
  }

  return result.stdout || "";
}

function runShell(command, options = {}) {
  const result = spawnSync("/bin/zsh", ["-lc", command], {
    cwd: options.cwd || REPO_ROOT,
    stdio: options.capture ? ["pipe", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    env: { ...process.env, ...(options.env || {}) },
  });

  if (result.status !== 0) {
    const stderr = result.stderr || "";
    const stdout = result.stdout || "";
    throw new Error(`Command failed: ${command}\n${stderr || stdout}`.trim());
  }

  return result.stdout || "";
}

function parseEnvFile(filePath) {
  const contents = fs.readFileSync(filePath, "utf8");
  const env = {};
  for (const line of contents.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1);
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function getIdToken(apiKey, email, password) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    },
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || "Could not authenticate super admin.");
  }
  return data.idToken;
}

async function apiRequest(token, pathname, init = {}) {
  const baseUrl = new URL(HQ_BASE_URL);
  const requestUrl = new URL(pathname, `${baseUrl.origin}/`);
  if (HQ_BYPASS_SECRET) {
    requestUrl.searchParams.set("x-vercel-protection-bypass", HQ_BYPASS_SECRET);
  }

  const res = await fetch(requestUrl, {
    ...init,
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(HQ_BYPASS_SECRET
        ? {
            "x-vercel-protection-bypass": HQ_BYPASS_SECRET,
          }
        : {}),
      ...(init.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Request failed for ${pathname}`);
  }
  return data;
}

function createStagingCopy() {
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "ciss-region-vercel-"));
  runShell(
    `rsync -a --delete --exclude='.git' --exclude='node_modules' --exclude='.next' --exclude='.next.stale.*' --exclude='.env*' --exclude='.playwright-cli' --exclude='.claude' --exclude='output' --exclude='streamvault' --exclude='.tmp' --exclude='tmp_ops_review' '${REPO_ROOT}/' '${stagingDir}/'`,
  );
  runShell(
    `find '${stagingDir}' -maxdepth 1 \\( -name '*.png' -o -name '*.pptx' -o -name 'update_ops_review.py' \\) -delete`,
  );
  return stagingDir;
}

function ensureVercelProject(projectName) {
  try {
    runCommand("npx", ["vercel", "project", "add", projectName, "--scope", TEAM_SLUG], {
      capture: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes("already exists")) {
      throw error;
    }
  }
}

function setProjectEnv(stagingDir, name, value, target) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  runCommand(
    "npx",
    [
      "vercel",
      "env",
      "add",
      name,
      target,
      "--value",
      String(value),
      "--force",
      "--yes",
      "--scope",
      TEAM_SLUG,
      "--cwd",
      stagingDir,
    ],
    { capture: true },
  );
}

function removeVercelProject(projectName) {
  runShell(`printf 'y\\n' | npx vercel project remove '${projectName}' --scope '${TEAM_SLUG}'`);
}

function vercelApi(endpoint, options = {}) {
  const args = ["vercel", "api", endpoint, "--scope", TEAM_SLUG, "--raw"];

  if (options.method) {
    args.push("-X", options.method);
  }

  if (options.inputPath) {
    args.push("--input", options.inputPath);
  }

  const output = runCommand("npx", args, { capture: true });
  return output ? JSON.parse(output) : null;
}

function updateProjectDefaults(projectName) {
  const patchFile = path.join(os.tmpdir(), `vercel-project-patch-${projectName}-${Date.now()}.json`);
  fs.writeFileSync(
    patchFile,
    JSON.stringify(
      {
        framework: "nextjs",
        nodeVersion: "22.x",
        ssoProtection: null,
      },
      null,
      2,
    ),
  );

  try {
    return vercelApi(`/v9/projects/${projectName}`, {
      method: "PATCH",
      inputPath: patchFile,
    });
  } finally {
    fs.rmSync(patchFile, { force: true });
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function probeUrl(url) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
    });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

function extractProjectAliasCandidates(projectName, projectData) {
  const candidates = new Set([
    buildProductionUrl(projectName),
    buildTeamProductionUrl(projectName),
  ]);

  const productionAliases = projectData?.targets?.production?.alias;
  if (Array.isArray(productionAliases)) {
    for (const alias of productionAliases) {
      if (typeof alias === "string" && alias.trim()) {
        candidates.add(alias.startsWith("http") ? alias : `https://${alias}`);
      }
    }
  }

  const latestAliases = projectData?.latestDeployments?.[0]?.alias;
  if (Array.isArray(latestAliases)) {
    for (const alias of latestAliases) {
      if (typeof alias === "string" && alias.trim()) {
        candidates.add(alias.startsWith("http") ? alias : `https://${alias}`);
      }
    }
  }

  return Array.from(candidates);
}

async function resolvePublicProductionUrl(projectName) {
  let lastCandidates = [];

  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const projectData = vercelApi(`/v9/projects/${projectName}`);
    const candidates = extractProjectAliasCandidates(projectName, projectData);
    lastCandidates = candidates;

    for (const candidate of candidates) {
      if (await probeUrl(candidate)) {
        return candidate;
      }
    }

    await sleep(4000);
  }

  throw new Error(
    `Could not verify a public regional URL for ${projectName}. Candidates checked: ${lastCandidates.join(", ")}`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const regionCode = (args._[0] || args["region-code"] || "").trim().toUpperCase();
  if (!regionCode) {
    fail("Usage: SUPER_ADMIN_PASSWORD=... node scripts/provision-region-vercel.mjs <REGION_CODE> [--region-name 'Tamil Nadu'] [--cleanup]");
  }

  const pulledEnvFile = path.join(os.tmpdir(), `ciss-source-${Date.now()}.env`);
  log("Pulling shared production envs from the Kerala Vercel project...");
  runCommand("npx", [
    "vercel",
    "env",
    "pull",
    pulledEnvFile,
    "--environment=production",
    "--cwd",
    REPO_ROOT,
    "--yes",
  ]);
  const sourceEnv = parseEnvFile(pulledEnvFile);

  const superAdminEmail =
    process.env.SUPER_ADMIN_EMAIL ||
    sourceEnv.SUPER_ADMIN_EMAIL ||
    sourceEnv.NEXT_PUBLIC_SUPER_ADMIN_EMAIL ||
    "super.admin@ciss.app";
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD;
  if (!superAdminPassword) {
    fail("SUPER_ADMIN_PASSWORD is required.");
  }

  const apiKey = sourceEnv.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    fail("Could not find NEXT_PUBLIC_FIREBASE_API_KEY in the source project env.");
  }

  const idToken = await getIdToken(apiKey, superAdminEmail, superAdminPassword);

  if (args.cleanup) {
    const regionData = await apiRequest(idToken, `/api/super-admin/regions/${regionCode}`);
    const region = regionData.region;
    const projectName =
      region.vercelProjectName || buildProjectName(region.regionName || regionCode, regionCode);
    log(`Removing Vercel project ${projectName}...`);
    removeVercelProject(projectName);
    await apiRequest(idToken, `/api/super-admin/regions/${regionCode}`, { method: "DELETE" });
    log(`Deleted region ${regionCode} and removed ${projectName}.`);
    return;
  }

  let region;
  try {
    const existing = await apiRequest(idToken, `/api/super-admin/regions/${regionCode}`);
    region = existing.region;
  } catch (error) {
    if (!args["region-name"]) {
      throw error;
    }

    const created = await apiRequest(idToken, "/api/super-admin/regions", {
      method: "POST",
      body: JSON.stringify({
        regionCode,
        regionName: args["region-name"],
        firebaseProjectId: args["firebase-project-id"] || sourceEnv.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        firebaseApiKey: args["firebase-api-key"] || sourceEnv.NEXT_PUBLIC_FIREBASE_API_KEY,
        firebaseWebAppId: args["firebase-web-app-id"] || sourceEnv.NEXT_PUBLIC_FIREBASE_APP_ID,
        storageBucket: args["storage-bucket"] || sourceEnv.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
        authDomain: args["auth-domain"] || sourceEnv.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        messagingSenderId:
          args["messaging-sender-id"] || sourceEnv.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
        measurementId: args["measurement-id"] || sourceEnv.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
        regionAdminEmail: args["region-admin-email"] || null,
      }),
    });
    region = created.region;
  }

  const deploymentData = await apiRequest(
    idToken,
    `/api/super-admin/regions/${regionCode}/deployment-config`,
  );
  const deploymentConfig = deploymentData.deploymentConfig;

  const projectName =
    region.vercelProjectName || buildProjectName(region.regionName, region.regionCode);
  const stagingDir = createStagingCopy();

  log(`Ensuring Vercel project ${projectName} exists...`);
  ensureVercelProject(projectName);
  log(`Applying regional Vercel defaults for ${projectName}...`);
  updateProjectDefaults(projectName);

  log(`Linking staging directory to ${projectName}...`);
  runCommand("npx", [
    "vercel",
    "link",
    "--yes",
    "--scope",
    TEAM_SLUG,
    "--project",
    projectName,
    "--cwd",
    stagingDir,
  ]);

  const targetEnv = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (!value || EXCLUDED_REGION_ENV_KEYS.has(key)) continue;
    targetEnv[key] = value;
  }
  Object.assign(targetEnv, deploymentConfig);

  log("Syncing regional Vercel environment variables...");
  for (const [key, value] of Object.entries(targetEnv)) {
    setProjectEnv(stagingDir, key, value, "production");
  }

  log("Deploying the regional runtime...");
  const deployOutput = runCommand("npx", [
    "vercel",
    "deploy",
    stagingDir,
    "--prod",
    "--public",
    "--scope",
    TEAM_SLUG,
    "-y",
  ], { capture: true });
  process.stdout.write(deployOutput);

  const deploymentUrl = extractDeploymentUrl(deployOutput, projectName);
  const productionUrl = await resolvePublicProductionUrl(projectName);
  const projectUrl = buildProjectUrl(projectName);

  await apiRequest(idToken, `/api/super-admin/regions/${regionCode}`, {
    method: "PATCH",
    body: JSON.stringify({
      vercelProjectName: projectName,
      vercelProjectUrl: projectUrl,
      vercelProductionUrl: productionUrl,
      vercelTeamSlug: TEAM_SLUG,
      lastVercelProvisionedAt: new Date().toISOString(),
      onboardingChecklist: {
        ...region.onboardingChecklist,
        vercelConfigured: true,
      },
    }),
  });

  log(`Deployment created at ${deploymentUrl}`);
  log(`Regional app ready at ${productionUrl}`);
  log(`Vercel project: ${projectUrl}`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
