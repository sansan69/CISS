import { getDownloadURL } from "firebase-admin/storage";
import { getStorage } from "@/lib/firebaseAdmin";

export async function getStoredAndroidApkUrl(version: string) {
  const file = getStorage().bucket().file(`releases/ciss-workforce-${version}.apk`);
  return getDownloadURL(file);
}

export function redirectAndroidApk(url: string) {
  return new Response(null, {
    status: 307,
    headers: { Location: url, "Cache-Control": "no-store, max-age=0" },
  });
}
