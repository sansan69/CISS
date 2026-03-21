import { NextResponse } from "next/server";
import {
  hasAdminAccess,
  requireAdminOrFieldOfficer,
  verifyRequestAuth,
  unauthorizedResponse,
} from "@/lib/server/auth";

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const url = new URL(request.url);
    const period = url.searchParams.get("period");
    const employeeId = url.searchParams.get("employeeId");

    let q = adminDb.collection("evaluations").orderBy("createdAt", "desc") as FirebaseFirestore.Query;
    if (period) q = q.where("period", "==", period);
    if (employeeId) q = q.where("employeeId", "==", employeeId);

    // FieldOfficers only see their evaluations
    const isAdmin =
      hasAdminAccess(decoded) ||
      (decoded.email && ["ciss.kochi@gmail.com"].includes(decoded.email as string));
    if (!isAdmin && decoded.role === "fieldOfficer") {
      q = q.where("evaluatedBy", "==", decoded.uid);
    }

    const snapshot = await q.limit(200).get();
    const evaluations = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ evaluations });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized");
  }
}

export async function POST(request: Request) {
  try {
    const decoded = requireAdminOrFieldOfficer(await verifyRequestAuth(request));
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const body = (await request.json()) as {
      employeeId?: string;
      employeeName?: string;
      employeeCode?: string;
      clientId?: string;
      clientName?: string;
      district?: string;
      period?: string;
      evaluatedByName?: string;
      criteria?: {
        punctuality?: number;
        uniformCompliance?: number;
        behaviorProfessionalism?: number;
        skillCompetency?: number;
        clientFeedback?: number;
      };
      comments?: string;
    };

    if (!body.employeeId || !body.period || !body.criteria) {
      return NextResponse.json({ error: "employeeId, period, and criteria are required." }, { status: 400 });
    }

    const c = body.criteria;
    const totalScore =
      (c.punctuality ?? 0) +
      (c.uniformCompliance ?? 0) +
      (c.behaviorProfessionalism ?? 0) +
      (c.skillCompetency ?? 0) +
      (c.clientFeedback ?? 0);
    const normalizedScore = Math.round((totalScore / 50) * 100);

    const now = new Date();
    const docRef = await adminDb.collection("evaluations").add({
      employeeId: body.employeeId,
      employeeName: body.employeeName ?? "",
      employeeCode: body.employeeCode ?? "",
      clientId: body.clientId ?? "",
      clientName: body.clientName ?? "",
      district: body.district ?? "",
      evaluatedBy: decoded.uid,
      evaluatedByName: body.evaluatedByName ?? decoded.email ?? "",
      period: body.period,
      criteria: {
        punctuality: c.punctuality ?? 0,
        uniformCompliance: c.uniformCompliance ?? 0,
        behaviorProfessionalism: c.behaviorProfessionalism ?? 0,
        skillCompetency: c.skillCompetency ?? 0,
        clientFeedback: c.clientFeedback ?? 0,
      },
      totalScore,
      normalizedScore,
      comments: body.comments ?? "",
      createdAt: now,
    });

    // Update guardScores aggregate
    await updateGuardScore(adminDb, body.employeeId, body.employeeName ?? "", body.employeeCode ?? "", body.clientId ?? "", body.clientName ?? "", body.district ?? "", normalizedScore, now);

    return NextResponse.json({ id: docRef.id, normalizedScore });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized");
  }
}

async function updateGuardScore(
  adminDb: FirebaseFirestore.Firestore,
  employeeId: string,
  employeeName: string,
  employeeCode: string,
  clientId: string,
  clientName: string,
  district: string,
  newScore: number,
  now: Date
) {
  try {
    const scoreRef = adminDb.collection("guardScores").doc(employeeId);
    const scoreDoc = await scoreRef.get();

    if (scoreDoc.exists) {
      const existing = scoreDoc.data()!;
      const totalEvals = (existing.totalEvaluations ?? 0) + 1;
      const allTimeAvg = Math.round(
        ((existing.allTimeAvgScore ?? 0) * (totalEvals - 1) + newScore) / totalEvals
      );
      await scoreRef.update({
        currentMonthScore: newScore,
        previousMonthScore: existing.currentMonthScore ?? 0,
        allTimeAvgScore: allTimeAvg,
        totalEvaluations: totalEvals,
        lastUpdated: now,
      });
    } else {
      await scoreRef.set({
        employeeId,
        employeeName,
        employeeCode,
        clientId,
        clientName,
        district,
        currentMonthScore: newScore,
        allTimeAvgScore: newScore,
        totalEvaluations: 1,
        totalTrainingsCompleted: 0,
        uniformComplianceRate: 0,
        attendanceRate: 0,
        badges: [],
        lastUpdated: now,
      });
    }
  } catch {
    // Non-critical — don't fail the evaluation save
  }
}
