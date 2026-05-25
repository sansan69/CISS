import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";

const INDIA_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
});

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const minAgeHours = parseInt(
      request.nextUrl.searchParams.get("minAgeHours") || "0",
      10,
    );
    const limit = Math.min(
      parseInt(request.nextUrl.searchParams.get("limit") || "100", 10),
      500,
    );

    const snapshot = await adminDb
      .collection("attendanceState")
      .where("lastStatus", "==", "In")
      .limit(limit)
      .get();

    const stale = snapshot.docs
      .map((doc) => {
        const d = doc.data() as Record<string, any>;
        const lastLoggedAt =
          d.lastLoggedAt?.toDate?.()?.toISOString() ?? d.lastLoggedAt ?? null;
        return {
          employeeDocId: doc.id,
          employeeName: d.employeeName ?? "Unknown",
          lastAttendanceDate: d.lastAttendanceDate ?? null,
          lastSiteId: d.lastSiteId ?? null,
          openSessionId: d.openSessionId ?? null,
          lastLoggedAt,
        };
      })
      .filter((entry) => {
        // Filter by minAgeHours if specified
        if (minAgeHours <= 0 || !entry.lastAttendanceDate) return true;
        const attendanceDate = new Date(
          entry.lastAttendanceDate + "T00:00:00+05:30",
        );
        const ageMs = Date.now() - attendanceDate.getTime();
        return ageMs >= minAgeHours * 60 * 60 * 1000;
      });

    return NextResponse.json({ count: stale.length, stale });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to query" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { Timestamp, FieldValue } = await import("firebase-admin/firestore");

    const body = await request.json().catch(() => ({}));
    const minAgeHours = parseInt(body.minAgeHours || "24", 10);
    const dryRun = body.dryRun === true;
    const limit = Math.min(parseInt(body.limit || "100", 10), 500);

    const now = Timestamp.now();
    const todayIST = INDIA_DATE_FORMATTER.format(now.toDate());

    // Query all guards currently in "In" state
    const snapshot = await adminDb
      .collection("attendanceState")
      .where("lastStatus", "==", "In")
      .limit(limit)
      .get();

    // Filter to only those whose lastAttendanceDate is at least minAgeHours old
    const staleEntries = snapshot.docs.filter((doc) => {
      const d = doc.data() as Record<string, any>;
      const lastDate = d.lastAttendanceDate as string | undefined;
      if (!lastDate) return false;

      const attendanceDate = new Date(lastDate + "T00:00:00+05:30");
      const ageMs = Date.now() - attendanceDate.getTime();
      return ageMs >= minAgeHours * 60 * 60 * 1000;
    });

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        totalInState: snapshot.size,
        staleCount: staleEntries.length,
        minAgeHours,
        stale: staleEntries.map((doc) => {
          const d = doc.data() as Record<string, any>;
          return {
            employeeDocId: doc.id,
            employeeName: d.employeeName ?? "Unknown",
            lastAttendanceDate: d.lastAttendanceDate ?? null,
            lastSiteId: d.lastSiteId ?? null,
            openSessionId: d.openSessionId ?? null,
          };
        }),
      });
    }

    let closedCount = 0;
    const results: Array<{
      employeeDocId: string;
      employeeName: string;
      staleDate: string;
      outLogId: string;
    }> = [];

    // Process each stale entry in its own transaction
    for (const doc of staleEntries) {
      const stateData = doc.data() as Record<string, any>;
      const employeeDocId = doc.id;
      const staleDate =
        (stateData.lastAttendanceDate as string) ?? "unknown";

      try {
        await adminDb.runTransaction(async (transaction) => {
          const staleOutLogRef = adminDb.collection("attendanceLogs").doc();

          transaction.set(staleOutLogRef, {
            employeeId: stateData.employeeDocId ?? employeeDocId,
            employeeDocId,
            employeeName: stateData.employeeName ?? "Unknown",
            status: "Out",
            attendanceDate: staleDate,
            siteId: stateData.lastSiteId ?? null,
            siteName: null,
            clientName: stateData.lastSiteClientName ?? null,
            autoClosed: true,
            autoClosedReason:
              "Cron auto-close: IN session from " +
              staleDate +
              " was never checked out. Closed on " +
              todayIST +
              ".",
            reportedAt: now,
            serverProcessedAt: now,
            createdAt: now,
            attendanceReviewWarnings: [
              "Auto-closed stale session from " +
                staleDate +
                " (cron cleanup).",
            ],
          });

          // Close the session if open
          if (stateData.openSessionId) {
            transaction.set(
              adminDb
                .collection("attendanceSessions")
                .doc(String(stateData.openSessionId)),
              {
                status: "closed",
                outLogId: staleOutLogRef.id,
                endedAt: now,
                autoClosed: true,
                autoClosedReason:
                  "Cron auto-close on " + todayIST,
                updatedAt: now,
              },
              { merge: true },
            );
          }

          // Clear attendanceState
          transaction.set(
            adminDb.collection("attendanceState").doc(employeeDocId),
            {
              lastStatus: "Out",
              lastAttendanceDate: staleDate,
              lastAttendanceId: staleOutLogRef.id,
              openSessionId: FieldValue.delete(),
              openSessionStartedAt: FieldValue.delete(),
              lastLoggedAt: now,
              updatedAt: now,
            },
            { merge: true },
          );

          results.push({
            employeeDocId,
            employeeName: stateData.employeeName ?? "Unknown",
            staleDate,
            outLogId: staleOutLogRef.id,
          });
        });

        closedCount++;
      } catch (err: any) {
        console.error(
          `Failed to auto-close stale session for ${employeeDocId}:`,
          err.message,
        );
      }
    }

    return NextResponse.json({
      success: true,
      totalInState: snapshot.size,
      staleDetected: staleEntries.length,
      closedCount,
      failedCount: staleEntries.length - closedCount,
      minAgeHours,
      results,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to auto-close stale sessions." },
      { status: 500 },
    );
  }
}
