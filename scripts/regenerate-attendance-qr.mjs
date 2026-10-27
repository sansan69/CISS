#!/usr/bin/env node
/**
 * Regenerate attendance QR badges after the QR signing secret changes.
 *
 * Existing badges were signed with the public Firebase web API key (the old
 * fallback). Once the app runs with a server-only secret, those badges no longer
 * verify, so every active guard needs a freshly signed `qrCodeUrl`.
 *
 * IMPORTANT — run this only:
 *   - after the web app that uses the new secret is deployed, and
 *   - with the production secret available (`CISS_QR_SECRET`, or
 *     `ATTENDANCE_VERIFICATION_SECRET`), e.g. `vercel env pull` on the
 *     production environment.
 * Running it with a different secret produces badges that will not verify.
 *
 * Default is a dry run. Pass --apply to write.
 *
 * Usage:
 *   CISS_QR_SECRET=… node --env-file=.env.local scripts/regenerate-attendance-qr.mjs
 *   CISS_QR_SECRET=… node --env-file=.env.local scripts/regenerate-attendance-qr.mjs --apply
 */
import crypto from "node:crypto";
import admin from "firebase-admin";
import QRCode from "qrcode";

const APPLY = process.argv.includes("--apply");
const BATCH = 200;

const secret =
  process.env.CISS_QR_SECRET ||
  process.env.ATTENDANCE_VERIFICATION_SECRET ||
  process.env.UPLOAD_TOKEN_SECRET ||
  process.env.NEXTAUTH_SECRET;

if (!secret) {
  console.error(
    "Refusing to run: set CISS_QR_SECRET (or ATTENDANCE_VERIFICATION_SECRET/UPLOAD_TOKEN_SECRET/NEXTAUTH_SECRET) to the production signing secret.",
  );
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});
const db = admin.firestore();

function sign(employeeId, phoneNumber) {
  const payload = `${employeeId}:${phoneNumber}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return signature.slice(0, 16);
}

function digits(value) {
  return String(value ?? "").replace(/\D/g, "").slice(-10);
}

async function buildQrCodeUrl(employeeId, fullName, phoneNumber) {
  const token = sign(employeeId, phoneNumber);
  const content = `CISS-ATTENDANCE\nEmployee ID: ${employeeId}\nName: ${fullName}\nPhone: ${phoneNumber}\nToken: ${token}`;
  return QRCode.toDataURL(content, {
    errorCorrectionLevel: "H",
    margin: 1,
    type: "image/png",
    width: 256,
  });
}

async function main() {
  console.log(`mode=${APPLY ? "APPLY" : "dry-run"}`);
  const employees = await db.collection("employees").get();
  const targets = employees.docs.filter((doc) => {
    const data = doc.data();
    if (String(data.status ?? "").trim().toLowerCase() !== "active") return false;
    if (typeof data.employeeId !== "string" || !data.employeeId) return false;
    const phone = digits(data.phoneNumber ?? data.phone ?? data.mobile);
    return phone.length === 10;
  });

  console.log(
    `[qr] employees=${employees.size} activeWithIdAndPhone=${targets.length}`,
  );

  let written = 0;
  for (let i = 0; i < targets.length; i += BATCH) {
    const slice = targets.slice(i, i + BATCH);
    if (!APPLY) {
      written += slice.length;
      continue;
    }
    const batch = db.batch();
    for (const doc of slice) {
      const data = doc.data();
      const employeeId = String(data.employeeId);
      const phone = digits(data.phoneNumber ?? data.phone ?? data.mobile);
      const fullName =
        String(data.fullName || data.name || "").trim() || "Guard";
      const qrCodeUrl = await buildQrCodeUrl(employeeId, fullName, phone);
      batch.update(doc.ref, { qrCodeUrl, qrCodeUpdatedAt: new Date() });
    }
    await batch.commit();
    written += slice.length;
  }

  console.log(`[qr] ${APPLY ? "regenerated" : "would regenerate"}=${written}`);
  if (!APPLY) console.log("Dry run only. Re-run with --apply to write.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
