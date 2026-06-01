# CISS Workforce APK Downloads

This directory contains the latest Android APK for field officers and guards.

## How to add a new release

1. Build the release APK from the private `CISS-Mobile` Flutter project:
   ```bash
   cd ../CISS-Mobile
   flutter build apk --release --split-per-abi
   ```

2. Copy the arm64 APK to this directory:
   ```bash
   cp build/app/outputs/flutter-apk/app-arm64-v8a-release.apk public/downloads/ciss-workforce-latest.apk
   ```

3. Commit and push (Vercel will auto-deploy):
   ```bash
   git add public/downloads/ciss-workforce-latest.apk
   git commit -m "release: mobile app vX.Y.Z"
   git push origin main
   ```

4. The APK will be live at:
   ```
   https://your-domain/downloads/ciss-workforce-latest.apk
   ```

## Notes
- The `CISS-Mobile` repo is private, so APKs must be distributed through this webapp
- Vercel already serves APKs with correct `Content-Type: application/vnd.android.package-archive` headers
- Field officers can download at `/download`
