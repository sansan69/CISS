#!/usr/bin/env node

import { config as loadEnv } from "dotenv";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

loadEnv({ path: new URL("../.env.local", import.meta.url).pathname });

function initAdmin() {
  if (getApps().length > 0) return getApps()[0];
  let credential;
  if (process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64) {
    credential = cert(JSON.parse(Buffer.from(process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64, "base64").toString("utf-8")));
  } else if (process.env.FIREBASE_ADMIN_SDK_CONFIG) {
    credential = cert(JSON.parse(process.env.FIREBASE_ADMIN_SDK_CONFIG));
  } else if (process.env.FIREBASE_ADMIN_PROJECT_ID && process.env.FIREBASE_ADMIN_CLIENT_EMAIL && process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
    credential = cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n"),
    });
  } else {
    throw new Error("No Firebase Admin credentials found in env");
  }
  return initializeApp({ credential, storageBucket: process.env.FIREBASE_ADMIN_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET });
}

const DRY_RUN = !process.argv.includes("--apply");

async function main() {
  const app = initAdmin();
  const db = getFirestore(app);
  const auth = getAuth(app);

  console.log(`\n${DRY_RUN ? "=== DRY RUN (no changes will be made) ===" : "=== LIVE RUN (data WILL be deleted) ==="}\n`);

  const batchLimit = 500;
  let totalDeleted = 0;

  async function deleteCollection(collectionPath, parentDoc, label) {
    let collectionRef = parentDoc ? parentDoc.collection(collectionPath) : db.collection(collectionPath);
    const snapshot = await collectionRef.get();
    if (snapshot.empty) {
      console.log(`  ${label}: empty, skipping`);
      return 0;
    }
    let count = 0;
    const docs = snapshot.docs;
    for (let i = 0; i < docs.length; i += batchLimit) {
      const chunk = docs.slice(i, i + batchLimit);
      if (!DRY_RUN) {
        const batch = db.batch();
        for (const doc of chunk) {
          batch.delete(doc.ref);
        }
        await batch.commit();
      }
      count += chunk.length;
    }
    console.log(`  ${label}: ${count} docs ${DRY_RUN ? "would be " : ""}deleted`);
    return count;
  }

  // 1. Find demo/test employees
  console.log("--- Scanning Employees ---");
  const employeesSnap = await db.collection("employees").get();
  const demoEmployeeIds = [];
  const realEmployeeIds = [];
  const demoPatterns = [
    /test/i, /demo/i, /sample/i, /example/i, /dummy/i, /fake/i,
    /john\s*doe/i, /jane\s*doe/i, /abc\s*xyz/i, /^xxx/i,
  ];
  const demoEmailPatterns = [
    /test@/i, /demo@/i, /example@/i, /sample@/i, /fake@/i,
  ];

  for (const doc of employeesSnap.docs) {
    const d = doc.data();
    const name = (d.name || d.fullName || "").toString();
    const email = (d.email || d.personalEmail || "").toString();
    const phone = (d.phoneNumber || d.phone || "").toString();
    const employeeId = (d.employeeId || "").toString();
    const status = (d.status || "").toString();

    const isDemo = demoPatterns.some(p => p.test(name)) ||
      demoEmailPatterns.some(p => p.test(email)) ||
      demoPatterns.some(p => p.test(employeeId));

    const hasMinimalData = !name.trim() && !phone.trim() && !email.trim();

    if (isDemo || hasMinimalData) {
      demoEmployeeIds.push({ id: doc.id, name, employeeId, reason: isDemo ? "pattern match" : "empty data" });
    } else {
      realEmployeeIds.push({ id: doc.id, name, employeeId });
    }
  }

  console.log(`  Total employees: ${employeesSnap.size}`);
  console.log(`  Demo/test employees found: ${demoEmployeeIds.length}`);
  console.log(`  Real employees: ${realEmployeeIds.length}`);

  if (demoEmployeeIds.length > 0) {
    console.log(`\n  Demo employees to delete:`);
    for (const e of demoEmployeeIds) {
      console.log(`    - [${e.id}] ${e.name} (${e.employeeId}) — ${e.reason}`);
    }
  }

  // Also list ALL employees for user confirmation
  if (employeesSnap.size > 0 && employeesSnap.size <= 50) {
    console.log(`\n  All employees in database:`);
    for (const e of realEmployeeIds) {
      console.log(`    - [${e.id}] ${e.name} (${e.employeeId}) — REAL`);
    }
  }

  // 2. Delete attendance logs for demo employees
  let attendanceDeleted = 0;
  if (demoEmployeeIds.length > 0) {
    console.log(`\n--- Cleaning Attendance Logs for Demo Employees ---`);
    for (const emp of demoEmployeeIds) {
      const logsSnap = await db.collection("attendanceLogs")
        .where("employeeDocId", "==", emp.id)
        .get();
      if (!logsSnap.empty) {
        for (let i = 0; i < logsSnap.docs.length; i += batchLimit) {
          const chunk = logsSnap.docs.slice(i, i + batchLimit);
          if (!DRY_RUN) {
            const batch = db.batch();
            for (const doc of chunk) batch.delete(doc.ref);
            await batch.commit();
          }
          attendanceDeleted += chunk.length;
        }
      }
    }
    console.log(`  Attendance logs for demo employees: ${attendanceDeleted} ${DRY_RUN ? "would be " : ""}deleted`);
  }

  // 3. Delete demo employees
  let employeesDeletedCount = 0;
  if (demoEmployeeIds.length > 0) {
    for (let i = 0; i < demoEmployeeIds.length; i += batchLimit) {
      const chunk = demoEmployeeIds.slice(i, i + batchLimit);
      if (!DRY_RUN) {
        const batch = db.batch();
        for (const e of chunk) batch.delete(db.doc(`employees/${e.id}`));
        await batch.commit();
      }
      employeesDeletedCount += chunk.length;
    }
    console.log(`\n  Demo employees: ${employeesDeletedCount} ${DRY_RUN ? "would be " : ""}deleted`);
  }

  // 4. Check for orphaned attendance logs (employeeDocId doesn't match any employee)
  console.log(`\n--- Scanning Orphaned Attendance Logs ---`);
  const allEmployeeDocIds = new Set(employeesSnap.docs.map(d => d.id));
  const allLogsSnap = await db.collection("attendanceLogs").get();
  let orphanedLogs = 0;
  const orphanedDocIds = [];

  for (const doc of allLogsSnap.docs) {
    const d = doc.data();
    if (d.employeeDocId && !allEmployeeDocIds.has(d.employeeDocId)) {
      orphanedDocIds.push(doc);
    }
  }

  if (orphanedDocIds.length > 0) {
    for (let i = 0; i < orphanedDocIds.length; i += batchLimit) {
      const chunk = orphanedDocIds.slice(i, i + batchLimit);
      if (!DRY_RUN) {
        const batch = db.batch();
        for (const doc of chunk) batch.delete(doc.ref);
        await batch.commit();
      }
      orphanedLogs += chunk.length;
    }
    console.log(`  Orphaned attendance logs (no matching employee): ${orphanedLogs} ${DRY_RUN ? "would be " : ""}deleted`);
  } else {
    console.log(`  No orphaned attendance logs found`);
  }

  // 6. Delete demo payroll cycles and their entries
  console.log(`\n--- Scanning Payroll Cycles ---`);
  const cyclesSnap = await db.collection("payrollCycles").get();
  let demoCyclesDeleted = 0;
  let demoPayrollEntriesDeleted = 0;
  const demoCycleIds = [];

  for (const doc of cyclesSnap.docs) {
    const d = doc.data();
    const id = doc.id;
    const isDemo = demoPatterns.some(p => p.test(id)) ||
      demoPatterns.some(p => p.test(d.label || d.name || ""));

    console.log(`    - [${id}] ${d.period || "no period"} label=${d.label || d.name || ""} status=${d.status || "unknown"}`);

    if (isDemo) {
      demoCycleIds.push(id);
      // Delete entries for this cycle
      const entriesSnap = await db.collection("payrollEntries")
        .where("cycleId", "==", id).get();
      if (!entriesSnap.empty) {
        for (let i = 0; i < entriesSnap.docs.length; i += batchLimit) {
          const chunk = entriesSnap.docs.slice(i, i + batchLimit);
          if (!DRY_RUN) {
            const batch = db.batch();
            for (const e of chunk) batch.delete(e.ref);
            await batch.commit();
          }
          demoPayrollEntriesDeleted += chunk.length;
        }
      }
      if (!DRY_RUN) await doc.ref.delete();
      demoCyclesDeleted++;
    }
  }
  console.log(`  Demo payroll cycles: ${demoCyclesDeleted} ${DRY_RUN ? "would be " : ""}deleted`);
  console.log(`  Demo payroll entries: ${demoPayrollEntriesDeleted} ${DRY_RUN ? "would be " : ""}deleted`);

  // Also delete orphaned payroll entries (employeeDocId no longer exists)
  const survivingEmployeeIds = new Set(realEmployeeIds.map(e => e.id));
  const allPayrollSnap = await db.collection("payrollEntries").get();
  let orphanedPayroll = 0;
  const orphanedPayrollDocs = [];
  for (const doc of allPayrollSnap.docs) {
    const d = doc.data();
    if (d.employeeDocId && !survivingEmployeeIds.has(d.employeeDocId)) {
      orphanedPayrollDocs.push(doc);
    }
  }
  if (orphanedPayrollDocs.length > 0) {
    for (let i = 0; i < orphanedPayrollDocs.length; i += batchLimit) {
      const chunk = orphanedPayrollDocs.slice(i, i + batchLimit);
      if (!DRY_RUN) {
        const batch = db.batch();
        for (const doc of chunk) batch.delete(doc.ref);
        await batch.commit();
      }
      orphanedPayroll += chunk.length;
    }
    console.log(`  Orphaned payroll entries: ${orphanedPayroll} ${DRY_RUN ? "would be " : ""}deleted`);
  }

  // 7. Delete demo auth users
  console.log(`\n--- Cleaning Demo Auth Users ---`);
  let demoAuthDeleted = 0;
  try {
    const listUsersResult = await auth.listUsers();
    for (const user of listUsersResult.users) {
      const email = user.email || "";
      const isDemo = demoEmailPatterns.some(p => p.test(email)) ||
        demoPatterns.some(p => p.test(email));
      if (isDemo) {
        console.log(`    DEMO: [${user.uid}] ${email}`);
        if (!DRY_RUN) {
          await auth.deleteUser(user.uid);
        }
        demoAuthDeleted++;
      }
    }
    console.log(`  Demo auth users: ${demoAuthDeleted} ${DRY_RUN ? "would be " : ""}deleted`);
  } catch (e) {
    console.log(`  Could not clean auth users: ${e.message}`);
  }

  // 8. Delete demo work orders (for demo employees)
  console.log(`\n--- Cleaning Demo Work Orders ---`);
  let demoWorkOrdersDeleted = 0;
  const demoEmployeeDocIds = new Set(demoEmployeeIds.map(e => e.id));
  const woSnap = await db.collection("workOrders").get();
  const demoWOs = [];
  for (const doc of woSnap.docs) {
    const d = doc.data();
    const assigned = Array.isArray(d.assignedGuards) ? d.assignedGuards : [];
    if (assigned.some(g => demoEmployeeDocIds.has(g?.uid || g?.employeeDocId))) {
      demoWOs.push(doc);
    }
  }
  if (demoWOs.length > 0) {
    for (let i = 0; i < demoWOs.length; i += batchLimit) {
      const chunk = demoWOs.slice(i, i + batchLimit);
      if (!DRY_RUN) {
        const batch = db.batch();
        for (const doc of chunk) batch.delete(doc.ref);
        await batch.commit();
      }
      demoWorkOrdersDeleted += chunk.length;
    }
    console.log(`  Demo work orders: ${demoWorkOrdersDeleted} ${DRY_RUN ? "would be " : ""}deleted`);
  } else {
    console.log(`  No demo work orders found`);
  }

  // 9. Delete demo public profiles
  console.log(`\n--- Cleaning Demo Public Profiles ---`);
  let demoProfilesDeleted = 0;
  for (const emp of demoEmployeeIds) {
    const profileRef = db.doc(`employees/${emp.id}/publicProfile/profile`);
    const profileSnap = await profileRef.get();
    if (profileSnap.exists) {
      if (!DRY_RUN) await profileRef.delete();
      demoProfilesDeleted++;
    }
  }
  console.log(`  Demo public profiles: ${demoProfilesDeleted} ${DRY_RUN ? "would be " : ""}deleted`);

  // Summary
  totalDeleted = employeesDeletedCount + attendanceDeleted + orphanedLogs + orphanedPayroll +
    demoCyclesDeleted + demoPayrollEntriesDeleted + demoWorkOrdersDeleted + demoProfilesDeleted;
  console.log(`\n=== Summary ===`);
  console.log(`Demo employees: ${employeesDeletedCount} ${DRY_RUN ? "would be " : ""}deleted`);
  console.log(`Attendance logs (demo): ${attendanceDeleted} ${DRY_RUN ? "would be " : ""}deleted`);
  console.log(`Orphaned attendance logs: ${orphanedLogs} ${DRY_RUN ? "would be " : ""}deleted`);
  console.log(`Demo payroll cycles: ${demoCyclesDeleted} ${DRY_RUN ? "would be " : ""}deleted`);
  console.log(`Demo payroll entries: ${demoPayrollEntriesDeleted} ${DRY_RUN ? "would be " : ""}deleted`);
  console.log(`Orphaned payroll entries: ${orphanedPayroll} ${DRY_RUN ? "would be " : ""}deleted`);
  console.log(`Demo work orders: ${demoWorkOrdersDeleted} ${DRY_RUN ? "would be " : ""}deleted`);
  console.log(`Demo public profiles: ${demoProfilesDeleted} ${DRY_RUN ? "would be " : ""}deleted`);
  console.log(`Demo auth users: ${demoAuthDeleted} ${DRY_RUN ? "would be " : ""}deleted`);
  console.log(`Total Firestore docs: ${totalDeleted} ${DRY_RUN ? "would be " : ""}deleted`);

  if (DRY_RUN && totalDeleted > 0) {
    console.log(`\nRun with --apply flag to actually delete data.`);
  }
}

main().catch(console.error);
