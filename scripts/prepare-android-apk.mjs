import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const manifest = JSON.parse(await readFile("public/downloads/ciss-workforce-android.json", "utf8"));
const version = manifest.latestVersionName;
const expectedPath = `/downloads/ciss-workforce-${version}.apk`;

if (!manifest.apkUrl && manifest.apkPath.startsWith("/")) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || manifest.apkPath !== expectedPath) {
    throw new Error("Invalid local Android release path");
  }

  const apk = join("public", manifest.apkPath);
  const isVerified = async () => {
    const file = await stat(apk).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (!file?.isFile() || file.size !== manifest.sizeBytes) return false;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(apk)) hash.update(chunk);
    return hash.digest("hex") === manifest.sha256;
  };

  if (!(await isVerified())) {
    const url = `https://github.com/sansan69/CISS-Mobile/releases/download/v${version}/app-release.apk`;
    const tempFile = `${apk}.${randomUUID()}.tmp`;
    const hash = createHash("sha256");
    let bytes = 0;
    const verify = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > manifest.sizeBytes) {
          callback(new Error("Android APK exceeds the expected size"));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(600_000) });
      if (!response.ok || !response.body) {
        throw new Error(`Android APK download returned HTTP ${response.status}`);
      }
      await pipeline(Readable.fromWeb(response.body), verify, createWriteStream(tempFile, { flags: "wx" }));
      if (bytes !== manifest.sizeBytes) {
        throw new Error(
          `Android APK download stopped at ${bytes} of ${manifest.sizeBytes} bytes`,
        );
      }
      await rename(tempFile, apk);
    } catch (error) {
      // A slow or unavailable release mirror must not fail the deployment. The
      // download route redirects to the GitHub release when the published
      // object is missing, so the app stays installable either way.
      console.warn(
        `Android APK ${version} could not be fetched (${
          error instanceof Error ? error.message : String(error)
        }); falling back to the GitHub release URL`,
      );
    } finally {
      await rm(tempFile, { force: true });
    }

    // Bytes that made it to disk must match the manifest. A mismatch is never
    // downgraded to a warning, because it would publish a corrupt build.
    const present = await stat(apk).then((file) => file.isFile()).catch(() => false);
    if (present && !(await isVerified())) {
      throw new Error("Android APK does not match the release manifest");
    }
  }

  if (!(await isVerified())) {
    console.log(`Android APK ${version} not published; the download route will use the GitHub release URL`);
  } else {
    console.log(`Verified Android APK ${version}`);
    if (process.env.CISS_REDIRECT_ANDROID_APK === "true") {
    const { applicationDefault, initializeApp } = await import("firebase-admin/app");
    const { getStorage } = await import("firebase-admin/storage");
    const app = initializeApp({ credential: applicationDefault() });
    const bucket = getStorage(app).bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
    const destination = `releases/ciss-workforce-${version}.apk`;
    try {
      try {
        await bucket.upload(apk, {
          destination,
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: {
            contentType: "application/vnd.android.package-archive",
            contentDisposition: `attachment; filename="ciss-workforce-${version}.apk"`,
            cacheControl: "public, max-age=31536000, immutable",
            metadata: { firebaseStorageDownloadTokens: randomUUID(), sha256: manifest.sha256 },
          },
        });
      } catch (error) {
        if (Number(error.code) !== 412) throw error;
      }
      const [metadata] = await bucket.file(destination).getMetadata();
      if (Number(metadata.size) !== manifest.sizeBytes || metadata.metadata?.sha256 !== manifest.sha256) {
        throw new Error("Existing Firebase Storage APK does not match the release manifest");
      }
      console.log(`Verified Firebase Storage APK ${version}`);
    } catch (error) {
      if (Number(error.code) !== 403) throw error;
      console.warn("Build account cannot publish the APK to Firebase Storage");
    }
  }
  }
}
