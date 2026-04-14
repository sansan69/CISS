# Hybrid QR Scanner Design

## Goal
Replace the app's duplicated QR scanner logic with one shared, mobile-first scanner system that is both fast and reliable.

## Current Problems
- Attendance and guard login each implement their own scanner lifecycle.
- Attendance uses stronger ZXing constraints than guard login, so behavior is inconsistent.
- There is no shared camera selection, scan cooldown, permission handling, or capability detection.
- The current setup does not take advantage of newer native browser scanning APIs when available.

## Recommended Approach
Build a shared hybrid scanner engine that:
- prefers the native `BarcodeDetector` API for fast QR detection on supported devices
- falls back to ZXing (`@zxing/browser`) for broad compatibility and damaged-code tolerance
- centralizes camera setup, scan lifecycle, duplicate suppression, and capability detection
- is reused by both attendance and guard-login flows

## Browser/Library Basis
- `BarcodeDetector` is a browser API for barcode scanning where supported.
- `@zxing/browser` provides browser-side QR scanning from camera/video streams and supports direct webcam scanning with reader controls.
- Media track capabilities can expose features like torch on supported devices.

## Architecture
### 1. Shared Scanner Module
Add a shared scanner layer, likely under `src/components/qr/` and/or `src/lib/qr/`, with:
- camera stream acquisition
- preferred camera selection
- native detector scan loop
- ZXing fallback loop
- start/stop/reset lifecycle
- scan cooldown/duplicate suppression
- normalized errors and status
- optional torch support when supported by the active track

### 2. Preferred Camera Strategy
Camera preference order:
1. environment/back camera on phones
2. best non-front camera if labels/devices can be distinguished
3. default available camera on laptops/desktops

Constraints should prefer a good mobile scanning feed without hard-failing if unsupported.

### 3. Hybrid Detection Strategy
Primary path:
- request video stream
- if `BarcodeDetector` exists and supports QR codes, run a lightweight detection loop against the live video
- on successful decode, stop scanning or lock according to consumer behavior

Fallback path:
- if native detector is unavailable, unsupported, or unstable, start ZXing scanning on the same video/camera target
- keep QR-only hints enabled
- keep a try-harder mode in fallback path

### 4. Shared Result Handling
The shared scanner returns normalized payloads such as:
- raw text
- timestamp
- source (`native` or `zxing`)
- optional device info

Each page keeps its own business logic:
- attendance parses employee id and fetches employee record
- guard login uses decoded employee id for portal login flow

### 5. UX Improvements
- clear loading states: starting camera, scanning, scan success, scan error
- clear permission error message
- no-camera message when device has no usable camera
- torch toggle only when supported
- rescan action that resets lock cleanly
- consistent camera framing guidance across both pages

## Scope
### In Scope
- shared hybrid scanner engine
- attendance integration
- guard-login integration
- better camera selection
- duplicate-result suppression
- torch support where supported
- unified stop/start cleanup
- tests around scanner decision logic and integration boundaries

### Out of Scope
- changing QR payload format
- redesigning attendance business flow
- redesigning guard-login business flow
- adding image-upload QR scanning from gallery

## Error Handling
Normalize scanner states into shared categories:
- permission denied
- no camera found
- camera busy/unavailable
- unsupported scanner mode
- scan timeout/no code yet
- invalid decoded payload

Consumers should only map these into page-specific messages.

## Testing
### Unit
- detector selection logic
- preferred camera selection logic
- duplicate suppression/cooldown logic
- torch capability detection helper

### Integration
- attendance scanner uses shared scanner entry points
- guard-login scanner uses shared scanner entry points
- stop/reset paths release tracks and scanner controls

### Manual
- phone back camera scan success
- laptop webcam scan success
- poor/blurred QR fallback still works
- permission denied state is clean
- rescan works without stale lock

## Success Criteria
- one scanner implementation used in both major QR flows
- faster first detection on supported mobile devices
- equal or better reliability for difficult QR codes
- fewer camera lifecycle bugs and duplicated logic
- cleaner user feedback across scanning surfaces
