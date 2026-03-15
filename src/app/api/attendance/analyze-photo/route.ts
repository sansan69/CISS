import { NextRequest, NextResponse } from "next/server";
import {
  attendancePhotoComplianceSchema,
  type AttendancePhotoCompliance,
} from "@/types/attendance";
import {
  SYSTEM_METRIC_NAMES,
  incrementSystemMetric,
} from "@/lib/server/monitoring";

export const runtime = "nodejs";

const GEMINI_MODEL = "gemini-1.5-flash";

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid image payload.");
  }

  return {
    mimeType: match[1],
    data: match[2],
  };
}

function extractJson(text: string) {
  const fenced = text.match(/```json\s*([\s\S]+?)```/i);
  if (fenced?.[1]) return fenced[1];
  const objectLike = text.match(/\{[\s\S]+\}/);
  return objectLike?.[0] ?? text;
}

function fallbackCompliance(message: string): AttendancePhotoCompliance {
  return {
    overallStatus: "analysis_failed",
    adminFlag: true,
    warnings: ["Uniform review could not be completed automatically."],
    summary: message,
    missingShoes: false,
    missingIdCard: false,
    uniformIssue: false,
    fullBodyVisible: false,
    onePersonVisible: true,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      photoDataUrl?: string;
      employeeName?: string;
      employeeId?: string;
      siteName?: string;
      district?: string;
      clientName?: string;
    };

    if (!body.photoDataUrl) {
      return NextResponse.json(
        { error: "Photo is required for compliance analysis." },
        { status: 400 },
      );
    }

    if (!process.env.GEMINI_API_KEY) {
      await incrementSystemMetric(SYSTEM_METRIC_NAMES.attendancePhotoAnalysisFailure);
      return NextResponse.json({
        compliance: fallbackCompliance(
          "AI review is not configured on the server.",
        ),
      });
    }

    const image = parseDataUrl(body.photoDataUrl);
    const prompt = [
      "You are reviewing one attendance photo of a single security guard for uniform compliance.",
      "Return JSON only with keys:",
      "overallStatus, adminFlag, warnings, summary, missingShoes, missingIdCard, uniformIssue, fullBodyVisible, onePersonVisible.",
      'Set overallStatus to "clear" when there are no visible issues, "warning" when there are likely issues, or "analysis_failed" only when the photo is too unclear to assess.',
      "Set adminFlag true when any warning exists or the image is unclear.",
      "Check carefully for:",
      "1. Shoes clearly visible.",
      "2. ID card clearly visible on the person.",
      "3. CISS-style uniform visible: black/navy CISS tshirt, blue shirt, or blue/grey churidhar with black shawl as seen in security duty photos.",
      "4. Full body or at least enough lower body to confirm shoes and uniform.",
      "5. Whether exactly one primary guard is visible. If multiple people are prominent, warn that this should be a single-guard attendance photo.",
      "Keep warnings short and practical. If uncertain, warn instead of claiming compliance.",
      `Context: employee=${body.employeeName || "unknown"} (${body.employeeId || "unknown"}), site=${body.siteName || "unknown"}, district=${body.district || "unknown"}, client=${body.clientName || "unknown"}.`,
    ].join("\n");

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: image.mimeType,
                    data: image.data,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1,
          },
        }),
      },
    );

    const raw = await response.json().catch(() => null);
    if (!response.ok) {
      await incrementSystemMetric(SYSTEM_METRIC_NAMES.attendancePhotoAnalysisFailure);
      return NextResponse.json({
        compliance: fallbackCompliance(
          raw?.error?.message || "AI review failed to complete.",
        ),
      });
    }

    const text =
      raw?.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part.text || "")
        .join("\n")
        .trim() || "";

    const parsed = attendancePhotoComplianceSchema.parse(
      JSON.parse(extractJson(text)),
    );

    await incrementSystemMetric(SYSTEM_METRIC_NAMES.attendancePhotoAnalysisSuccess);
    return NextResponse.json({ compliance: parsed });
  } catch (error: any) {
    await incrementSystemMetric(SYSTEM_METRIC_NAMES.attendancePhotoAnalysisFailure);
    console.error("Attendance photo analysis failed:", error);
    return NextResponse.json({
      compliance: fallbackCompliance(
        error?.message || "Uniform review could not be completed automatically.",
      ),
    });
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed." }, { status: 405 });
}
