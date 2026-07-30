# CISS Workforce Android releases

The web application uses `ciss-workforce-android.json` as the single source for:

- the landing-page version and release size;
- the `/download` installation page;
- `/api/public/download/android`, the stable download redirect; and
- `/api/public/app-update`, consumed by installed Android applications.

## Preferred distribution

Production releases should be published through Managed Google Play. Keep the
direct APK route as a fallback for unmanaged devices.

Fallback APKs should be stored as immutable, versioned objects in Firebase
Storage, Google Cloud Storage, or another controlled object store. Add the
public HTTPS asset URL as `apkUrl` in the manifest:

```json
{
  "apkPath": "/downloads/fallback.apk",
  "apkUrl": "https://releases.example.com/ciss-workforce-1.0.17.apk"
}
```

`apkUrl` takes precedence. `apkPath` remains required as an emergency
root-relative fallback.

## Release procedure

1. Bump `version:` in the private `CISS-Mobile/pubspec.yaml`.
2. Push and tag the mobile commit with the matching version, such as `v1.0.17`.
3. The mobile GitHub workflow must pass analysis and tests, production-sign the
   AAB/APKs, verify the approved certificate, and publish checksums.
4. Upload the universal APK to the external immutable release location.
5. Update `ciss-workforce-android.json` with:
   - version name and code;
   - minimum supported code;
   - immutable `apkUrl`;
   - SHA-256 and exact byte size;
   - release date and notes.
6. Verify:

   ```bash
   curl https://cisskerala.site/api/public/app-update
   curl -I https://cisskerala.site/api/public/download/android
   ```

## Transitional local hosting

Existing versioned APKs, including the `1.0.17` transition release, remain in
this directory until an external bucket or Managed Google Play rollout is
ready. Do not add another APK copy to Git. Once the manifest points at a
verified external asset, remove the historical APKs in a separate cleanup
commit.
