import { describe, expect, it } from "vitest";
import {
  formatReleaseSize,
  getAndroidRelease,
  parseAndroidRelease,
  resolveAndroidApkUrl,
} from "./android-release";

describe("Android release metadata", () => {
  it("loads and validates the published manifest", async () => {
    const release = await getAndroidRelease();

    expect(release.platform).toBe("android");
    expect(release.latestVersionCode).toBeGreaterThanOrEqual(
      release.minimumSupportedVersionCode,
    );
    expect(release.sha256).toMatch(/^[a-f0-9]{64}$/i);
    expect(formatReleaseSize(release.sizeBytes)).toMatch(/^\d+ MB$/);
  });

  it("supports an externally hosted immutable APK", () => {
    const release = parseAndroidRelease({
      platform: "android",
      packageName: "co.in.ciss.ciss_mobile",
      latestVersionName: "2.0.0",
      latestVersionCode: 20,
      minimumSupportedVersionCode: 18,
      apkPath: "/downloads/fallback.apk",
      apkUrl: "https://releases.example.com/ciss-workforce-2.0.0.apk",
      sha256: "a".repeat(64),
      sizeBytes: 40_000_000,
      releaseDate: "2026-07-30",
      releaseNotes: ["Signed production release."],
      mandatory: false,
    });

    expect(resolveAndroidApkUrl(release, "https://cisskerala.site")).toBe(
      "https://releases.example.com/ciss-workforce-2.0.0.apk",
    );
  });

  it("rejects unsafe relative asset paths", () => {
    expect(() =>
      parseAndroidRelease({
        platform: "android",
        packageName: "co.in.ciss.ciss_mobile",
        latestVersionName: "2.0.0",
        latestVersionCode: 20,
        minimumSupportedVersionCode: 18,
        apkPath: "downloads/app.apk",
        sha256: "a".repeat(64),
        sizeBytes: 40_000_000,
        releaseDate: "2026-07-30",
        releaseNotes: [],
        mandatory: false,
      }),
    ).toThrow(/apkPath/);
  });
});
