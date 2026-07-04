# CISS Workforce APK Downloads

This directory contains the latest Android APK for field officers and guards.

## How to add a new release

1. Build the release APK from the private `CISS-Mobile` Flutter project:
   ```bash
   cd ../CISS-Mobile
   flutter build apk --release --split-per-abi
   ```

2. Copy the universal APK to a versioned file and update the latest compatibility copy:
   ```bash
   cp build/app/outputs/flutter-apk/app-release.apk public/downloads/ciss-workforce-X.Y.Z.apk
   cp build/app/outputs/flutter-apk/app-release.apk public/downloads/ciss-workforce-latest.apk
   ```

3. Update `public/downloads/ciss-workforce-android.json` with the versioned APK path, size, and SHA-256.

4. Commit and push (Vercel will auto-deploy):
   ```bash
   git add public/downloads/
   git commit -m "release: mobile app vX.Y.Z"
   git push origin main
   ```

5. The public download page uses a non-cached redirect at:
   ```
   https://your-domain/api/public/download/android
   ```

## Notes
- The `CISS-Mobile` repo is private, so APKs must be distributed through this webapp
- Vercel already serves APKs with correct `Content-Type: application/vnd.android.package-archive` headers
- Field officers can download at `/download`
