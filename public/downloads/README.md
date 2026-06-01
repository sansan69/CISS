# CISS Workforce APK Downloads

Place the latest Android APK file in this directory.

## Naming convention
- `ciss-workforce-latest.apk` — Main production APK (arm64-v8a)
- `ciss-workforce-latest-x86_64.apk` — Optional x86_64 build for emulators

## How to add a new release

1. Build the release APK from the `CISS-Mobile` Flutter project:
   ```bash
   cd ../CISS-Mobile
   flutter build apk --release --split-per-abi
   ```

2. Copy the arm64 APK to this directory:
   ```bash
   cp build/app/outputs/flutter-apk/app-arm64-v8a-release.apk public/downloads/ciss-workforce-latest.apk
   ```

3. Update the version number in `src/app/download/page.tsx`

4. Commit and push:
   ```bash
   git add public/downloads/ciss-workforce-latest.apk
   git commit -m "release: mobile app vX.Y.Z"
   git push origin main
   ```

## Download URL
Once deployed, the APK will be available at:
```
https://<your-domain>/downloads/ciss-workforce-latest.apk
```

The `vercel.json` already configures correct `Content-Type` and `Cache-Control` headers for all files in `/downloads/`.
