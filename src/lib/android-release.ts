import { promises as fs } from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import { z } from "zod";

export const ANDROID_DOWNLOAD_PATH = "/api/public/download/android";
export const ANDROID_DOWNLOAD_PAGE_URL =
  process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ||
  "https://cisskerala.site";

const androidReleaseSchema = z
  .object({
    platform: z.literal("android"),
    packageName: z.string().min(1),
    latestVersionName: z.string().min(1),
    latestVersionCode: z.number().int().positive(),
    minimumSupportedVersionCode: z.number().int().positive(),
    apkPath: z.string().min(1),
    apkUrl: z.string().url().optional(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    sizeBytes: z.number().int().positive(),
    releaseDate: z.string().min(1),
    releaseNotes: z.array(z.string().min(1)),
    mandatory: z.boolean(),
  })
  .superRefine((release, context) => {
    if (
      !release.apkUrl &&
      !release.apkPath.startsWith("/") &&
      !/^https:\/\//i.test(release.apkPath)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["apkPath"],
        message: "apkPath must be an absolute HTTPS URL or a root-relative path.",
      });
    }
    if (release.minimumSupportedVersionCode > release.latestVersionCode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minimumSupportedVersionCode"],
        message: "minimumSupportedVersionCode cannot exceed latestVersionCode.",
      });
    }
  });

export type AndroidRelease = z.infer<typeof androidReleaseSchema>;

export function parseAndroidRelease(value: unknown): AndroidRelease {
  return androidReleaseSchema.parse(value);
}

export async function getAndroidRelease(): Promise<AndroidRelease> {
  const manifestPath = path.join(
    process.cwd(),
    "public",
    "downloads",
    "ciss-workforce-android.json",
  );
  const raw = await fs.readFile(manifestPath, "utf8");
  return parseAndroidRelease(JSON.parse(raw));
}

export function resolveAndroidApkUrl(
  release: AndroidRelease,
  requestOrigin: string,
): string {
  return new URL(release.apkUrl || release.apkPath, requestOrigin).toString();
}

export function formatReleaseSize(sizeBytes: number): string {
  return `${Math.round(sizeBytes / (1024 * 1024))} MB`;
}

export async function createAndroidDownloadQr(): Promise<string> {
  return QRCode.toDataURL(`${ANDROID_DOWNLOAD_PAGE_URL}/download`, {
    width: 240,
    margin: 1,
    errorCorrectionLevel: "M",
    color: {
      dark: "#082F55",
      light: "#F4F7FB",
    },
  });
}
