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

// Rate limiter: max 20 photo analyses per IP per minute (Gemini calls are expensive)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count += 1;
  return true;
}

if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap.entries()) {
      if (now > entry.resetAt) rateLimitMap.delete(ip);
    }
  }, RATE_LIMIT_WINDOW_MS * 5);
}

const GEMINI_MODEL = "gemini-2.0-flash";
const MAX_RESPONSE_TOKENS = 180;

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
    const ip = getClientIp(request);
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment and try again." },
        { status: 429 },
      );
    }

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
      "Review this single-guard attendance photo.",
      "Return JSON only with keys overallStatus, adminFlag, warnings, summary, missingShoes, missingIdCard, uniformIssue, fullBodyVisible, onePersonVisible.",
      'overallStatus: "clear", "warning", or "analysis_failed".',
      "Warn if shoes are not visible, ID card is not visible, CISS uniform is missing/unclear, full body is not visible, or multiple people are prominent.",
      "Allowed uniform examples: black/navy CISS tshirt, blue security shirt, blue or grey churidhar with black shawl.",
      "If unsure, warn. Keep warnings and summary very short.",
      `Context: ${body.employeeName || "unknown"} (${body.employeeId || "unknown"}), ${body.siteName || "unknown"}, ${body.district || "unknown"}, ${body.clientName || "unknown"}.`,
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
            maxOutputTokens: MAX_RESPONSE_TOKENS,
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
