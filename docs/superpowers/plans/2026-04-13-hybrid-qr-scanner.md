# Hybrid QR Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one fast and reliable hybrid QR scanning system shared by attendance and guard-login flows.

**Architecture:** Add a shared QR scanner module that prefers native `BarcodeDetector` for speed and falls back to ZXing for compatibility and difficult codes. Keep page-specific business logic in attendance and guard-login, but move camera handling, scan loops, capability checks, and lifecycle cleanup into shared code.

**Tech Stack:** Next.js App Router, React, TypeScript, browser MediaDevices APIs, `BarcodeDetector`, `@zxing/browser`, Vitest

---

## File Map

- Create: `/Users/mymac/Documents/CISS/src/lib/qr/scanner-types.ts`
  - Shared scanner types, states, error enums, normalized result types.
- Create: `/Users/mymac/Documents/CISS/src/lib/qr/scanner-support.ts`
  - Environment detection, native scanner support check, camera selection, torch capability helpers.
- Create: `/Users/mymac/Documents/CISS/src/lib/qr/scanner-engine.ts`
  - Shared scanner runtime: stream start, native scan loop, ZXing fallback, stop/reset, duplicate suppression.
- Create: `/Users/mymac/Documents/CISS/src/lib/qr/scanner-support.test.ts`
  - Unit tests for support helpers.
- Create: `/Users/mymac/Documents/CISS/src/lib/qr/scanner-engine.test.ts`
  - Unit tests for duplicate suppression and detector selection behavior.
- Modify: `/Users/mymac/Documents/CISS/src/app/attendance/page.tsx`
  - Replace in-page ZXing lifecycle with shared scanner engine while preserving attendance behavior.
- Modify: `/Users/mymac/Documents/CISS/src/app/guard-login/page.tsx`
  - Replace in-page ZXing lifecycle with shared scanner engine while preserving login behavior.
- Modify: `/Users/mymac/Documents/CISS/src/app/landing-page-surface.test.ts`
  - No change expected unless unrelated imports break tests; leave untouched if unnecessary.

### Task 1: Shared QR types and support helpers

**Files:**
- Create: `/Users/mymac/Documents/CISS/src/lib/qr/scanner-types.ts`
- Create: `/Users/mymac/Documents/CISS/src/lib/qr/scanner-support.ts`
- Test: `/Users/mymac/Documents/CISS/src/lib/qr/scanner-support.test.ts`

- [ ] **Step 1: Write the failing support-helper tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  choosePreferredVideoInput,
  isTorchSupported,
  normalizeScannerError,
  shouldUseNativeBarcodeDetector,
} from './scanner-support';

describe('shouldUseNativeBarcodeDetector', () => {
  it('returns true when BarcodeDetector exists and QR is supported', async () => {
    const nativeDetector = class {
      static async getSupportedFormats() {
        return ['qr_code', 'ean_13'];
      }
    };

    expect(await shouldUseNativeBarcodeDetector(nativeDetector as never)).toBe(true);
  });

  it('returns false when QR is not supported', async () => {
    const nativeDetector = class {
      static async getSupportedFormats() {
        return ['ean_13'];
      }
    };

    expect(await shouldUseNativeBarcodeDetector(nativeDetector as never)).toBe(false);
  });
});

describe('choosePreferredVideoInput', () => {
  it('prefers environment/back camera labels', () => {
    const devices = [
      { deviceId: 'front', kind: 'videoinput', label: 'Front Camera' },
      { deviceId: 'rear', kind: 'videoinput', label: 'Back Camera' },
    ] as MediaDeviceInfo[];

    expect(choosePreferredVideoInput(devices)?.deviceId).toBe('rear');
  });

  it('falls back to first videoinput', () => {
    const devices = [
      { deviceId: 'only', kind: 'videoinput', label: '' },
    ] as MediaDeviceInfo[];

    expect(choosePreferredVideoInput(devices)?.deviceId).toBe('only');
  });
});

describe('isTorchSupported', () => {
  it('returns true only when track capabilities expose torch', () => {
    const track = {
      getCapabilities: () => ({ torch: true }),
    } as MediaStreamTrack;

    expect(isTorchSupported(track)).toBe(true);
  });
});

describe('normalizeScannerError', () => {
  it('maps permission errors to permission-denied', () => {
    const error = new DOMException('Permission denied', 'NotAllowedError');
    expect(normalizeScannerError(error)).toBe('permission-denied');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run /Users/mymac/Documents/CISS/src/lib/qr/scanner-support.test.ts`
Expected: FAIL because the module and functions do not exist yet.

- [ ] **Step 3: Write minimal shared types**

```ts
export type QrScannerBackend = 'native' | 'zxing';

export type QrScannerErrorCode =
  | 'permission-denied'
  | 'no-camera'
  | 'camera-unavailable'
  | 'unsupported'
  | 'unknown';

export type QrScannerStatus = 'idle' | 'starting' | 'scanning' | 'locked' | 'stopped';

export type QrScanResult = {
  text: string;
  backend: QrScannerBackend;
  scannedAt: number;
  deviceId?: string;
};
```

Save to `/Users/mymac/Documents/CISS/src/lib/qr/scanner-types.ts`.

- [ ] **Step 4: Write minimal support helpers**

```ts
import type { QrScannerErrorCode } from './scanner-types';

const BACK_CAMERA_PATTERNS = [/back/i, /rear/i, /environment/i, /world/i];
const FRONT_CAMERA_PATTERNS = [/front/i, /user/i, /facetime/i];

export async function shouldUseNativeBarcodeDetector(
  Detector: typeof BarcodeDetector | undefined,
): Promise<boolean> {
  if (!Detector || typeof Detector.getSupportedFormats !== 'function') return false;
  try {
    const formats = await Detector.getSupportedFormats();
    return formats.includes('qr_code');
  } catch {
    return false;
  }
}

export function choosePreferredVideoInput(devices: MediaDeviceInfo[]): MediaDeviceInfo | null {
  const videoInputs = devices.filter((device) => device.kind === 'videoinput');
  if (videoInputs.length === 0) return null;

  const rear = videoInputs.find((device) => BACK_CAMERA_PATTERNS.some((pattern) => pattern.test(device.label)));
  if (rear) return rear;

  const nonFront = videoInputs.find((device) => !FRONT_CAMERA_PATTERNS.some((pattern) => pattern.test(device.label)));
  if (nonFront) return nonFront;

  return videoInputs[0] ?? null;
}

export function isTorchSupported(track: MediaStreamTrack | null | undefined): boolean {
  if (!track || typeof track.getCapabilities !== 'function') return false;
  const capabilities = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
  return capabilities.torch === true;
}

export function normalizeScannerError(error: unknown): QrScannerErrorCode {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'permission-denied';
    if (error.name === 'NotFoundError') return 'no-camera';
    if (error.name === 'NotReadableError' || error.name === 'AbortError') return 'camera-unavailable';
  }

  return 'unknown';
}
```

Save to `/Users/mymac/Documents/CISS/src/lib/qr/scanner-support.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run /Users/mymac/Documents/CISS/src/lib/qr/scanner-support.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add /Users/mymac/Documents/CISS/src/lib/qr/scanner-types.ts /Users/mymac/Documents/CISS/src/lib/qr/scanner-support.ts /Users/mymac/Documents/CISS/src/lib/qr/scanner-support.test.ts
git commit -m "feat: add qr scanner support helpers"
```

### Task 2: Shared scanner engine with native-first fallback

**Files:**
- Create: `/Users/mymac/Documents/CISS/src/lib/qr/scanner-engine.ts`
- Test: `/Users/mymac/Documents/CISS/src/lib/qr/scanner-engine.test.ts`

- [ ] **Step 1: Write the failing engine tests**

```ts
import { describe, expect, it } from 'vitest';
import { createDuplicateScanGuard, shouldFallbackToZxing } from './scanner-engine';

describe('createDuplicateScanGuard', () => {
  it('suppresses repeated payloads inside the cooldown window', () => {
    const guard = createDuplicateScanGuard(1200);

    expect(guard.accept('EMP001', 1000)).toBe(true);
    expect(guard.accept('EMP001', 1500)).toBe(false);
    expect(guard.accept('EMP001', 2301)).toBe(true);
  });
});

describe('shouldFallbackToZxing', () => {
  it('falls back when native detector is unavailable', () => {
    expect(shouldFallbackToZxing({ nativeSupported: false, nativeFailed: false })).toBe(true);
  });

  it('falls back when native detector failed during runtime', () => {
    expect(shouldFallbackToZxing({ nativeSupported: true, nativeFailed: true })).toBe(true);
  });

  it('does not fall back immediately when native detector is healthy', () => {
    expect(shouldFallbackToZxing({ nativeSupported: true, nativeFailed: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run /Users/mymac/Documents/CISS/src/lib/qr/scanner-engine.test.ts`
Expected: FAIL because the engine module does not exist yet.

- [ ] **Step 3: Write minimal engine helpers first**

```ts
export function createDuplicateScanGuard(cooldownMs: number) {
  let lastText = '';
  let lastAt = 0;

  return {
    accept(text: string, now = Date.now()) {
      if (text === lastText && now - lastAt < cooldownMs) return false;
      lastText = text;
      lastAt = now;
      return true;
    },
    reset() {
      lastText = '';
      lastAt = 0;
    },
  };
}

export function shouldFallbackToZxing({
  nativeSupported,
  nativeFailed,
}: {
  nativeSupported: boolean;
  nativeFailed: boolean;
}) {
  return !nativeSupported || nativeFailed;
}
```

Add these first to `/Users/mymac/Documents/CISS/src/lib/qr/scanner-engine.ts`.

- [ ] **Step 4: Extend the engine file with shared runtime code**

```ts
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { choosePreferredVideoInput, normalizeScannerError, shouldUseNativeBarcodeDetector } from './scanner-support';
import type { QrScanResult, QrScannerErrorCode } from './scanner-types';

export type StartQrScannerOptions = {
  video: HTMLVideoElement;
  cooldownMs?: number;
  onResult: (result: QrScanResult) => void;
  onError?: (error: QrScannerErrorCode) => void;
};

export async function startHybridQrScanner({
  video,
  cooldownMs = 1200,
  onResult,
  onError,
}: StartQrScannerOptions) {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const preferred = choosePreferredVideoInput(devices);

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: preferred?.deviceId
      ? { deviceId: { ideal: preferred.deviceId } }
      : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });

  video.srcObject = stream;
  await video.play();

  const duplicateGuard = createDuplicateScanGuard(cooldownMs);
  let stopped = false;
  let controls: { stop: () => void } | null = null;
  let nativeFailed = false;

  const stop = () => {
    stopped = true;
    controls?.stop();
    stream.getTracks().forEach((track) => track.stop());
    if (video.srcObject === stream) video.srcObject = null;
    duplicateGuard.reset();
  };

  const nativeSupported = await shouldUseNativeBarcodeDetector(globalThis.BarcodeDetector);

  if (nativeSupported) {
    try {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const tick = async () => {
        if (stopped) return;
        try {
          const barcodes = await detector.detect(video);
          const first = barcodes[0]?.rawValue?.trim();
          if (first && duplicateGuard.accept(first)) {
            onResult({ text: first, backend: 'native', scannedAt: Date.now(), deviceId: preferred?.deviceId });
          }
        } catch {
          nativeFailed = true;
        }
        if (!stopped && !nativeFailed) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      nativeFailed = true;
    }
  }

  if (shouldFallbackToZxing({ nativeSupported, nativeFailed })) {
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
    hints.set(DecodeHintType.TRY_HARDER, true);

    const reader = new BrowserMultiFormatReader(hints);
    controls = await reader.decodeFromVideoDevice(preferred?.deviceId, video, (result) => {
      const text = result?.getText()?.trim();
      if (text && duplicateGuard.accept(text)) {
        onResult({ text, backend: 'zxing', scannedAt: Date.now(), deviceId: preferred?.deviceId });
      }
    });
  }

  return { stop, stream, deviceId: preferred?.deviceId };
}

export async function startSafeHybridQrScanner(options: StartQrScannerOptions) {
  try {
    return await startHybridQrScanner(options);
  } catch (error) {
    options.onError?.(normalizeScannerError(error));
    throw error;
  }
}
```

- [ ] **Step 5: Run tests to verify helpers pass**

Run: `npx vitest run /Users/mymac/Documents/CISS/src/lib/qr/scanner-engine.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add /Users/mymac/Documents/CISS/src/lib/qr/scanner-engine.ts /Users/mymac/Documents/CISS/src/lib/qr/scanner-engine.test.ts
git commit -m "feat: add hybrid qr scanner engine"
```

### Task 3: Integrate attendance with shared scanner

**Files:**
- Modify: `/Users/mymac/Documents/CISS/src/app/attendance/page.tsx`
- Test: reuse `/Users/mymac/Documents/CISS/src/lib/qr/scanner-engine.test.ts`

- [ ] **Step 1: Write the failing refactor target by identifying direct ZXing usages**

Confirm these imports/usages are still present before editing:

```bash
rg -n "BrowserMultiFormatReader|DecodeHintType|BarcodeFormat|decodeFromConstraints" /Users/mymac/Documents/CISS/src/app/attendance/page.tsx
```

Expected: lines showing the old in-page ZXing scanner code.

- [ ] **Step 2: Replace old scanner import/use with shared engine**

Implement these code changes in `/Users/mymac/Documents/CISS/src/app/attendance/page.tsx`:

```ts
import { startSafeHybridQrScanner } from '@/lib/qr/scanner-engine';
```

Replace the old scanner ref type and controls storage with a simpler controller ref:

```ts
const scannerSessionRef = useRef<{ stop: () => void } | null>(null);
```

Replace the body of `startScanner` with a shared-engine call:

```ts
const startScanner = async () => {
  try {
    setIsScanning(true);
    scanLockedRef.current = false;

    scannerSessionRef.current?.stop();
    scannerSessionRef.current = await startSafeHybridQrScanner({
      video: videoRef.current!,
      onResult: async ({ text }) => {
        if (scanLockedRef.current) return;
        scanLockedRef.current = true;

        const parsedId = parseEmployeeIdFromText(text);
        if (!parsedId) {
          toast({ variant: 'destructive', title: 'Invalid QR', description: 'Could not parse Employee ID' });
          scanLockedRef.current = false;
          return;
        }

        setEmployeeId(parsedId);
        await fetchEmployee(parsedId);
      },
      onError: (errorCode) => {
        const descriptions: Record<string, string> = {
          'permission-denied': 'Camera access was denied. Please allow camera permission and try again.',
          'no-camera': 'No camera was found on this device.',
          'camera-unavailable': 'Camera is busy or unavailable. Close other camera apps and try again.',
          unsupported: 'This browser does not support QR scanning on this device.',
          unknown: 'Unable to start QR scanner.',
        };
        toast({ variant: 'destructive', title: 'Scanner error', description: descriptions[errorCode] ?? descriptions.unknown });
      },
    });
  } catch {
    setIsScanning(false);
  }
};
```

Update cleanup to use `scannerSessionRef.current?.stop()` instead of direct ZXing reset logic.

- [ ] **Step 3: Run typecheck for the attendance page refactor**

Run: `npm run typecheck`
Expected: PASS with no new attendance scanner type errors.

- [ ] **Step 4: Commit**

```bash
git add /Users/mymac/Documents/CISS/src/app/attendance/page.tsx
git commit -m "refactor: share attendance qr scanner"
```

### Task 4: Integrate guard login with shared scanner

**Files:**
- Modify: `/Users/mymac/Documents/CISS/src/app/guard-login/page.tsx`

- [ ] **Step 1: Write the failing refactor target by identifying old in-page scanner code**

Run:

```bash
rg -n "BrowserMultiFormatReader|DecodeHintType|BarcodeFormat|decodeFromConstraints" /Users/mymac/Documents/CISS/src/app/guard-login/page.tsx
```

Expected: old scanner logic still present.

- [ ] **Step 2: Replace old scanner lifecycle with shared engine**

Add import:

```ts
import { startSafeHybridQrScanner } from '@/lib/qr/scanner-engine';
```

Use a shared session ref:

```ts
const scannerSessionRef = useRef<{ stop: () => void } | null>(null);
```

Update `stopScanner`:

```ts
const stopScanner = () => {
  scannerSessionRef.current?.stop();
  scannerSessionRef.current = null;
  setIsScanning(false);
};
```

Update `startScanner`:

```ts
const startScanner = async () => {
  if (!videoRef.current) return;
  setQrError('');
  setScannedEmployeeId('');
  setIsScanning(true);

  try {
    scannerSessionRef.current?.stop();
    scannerSessionRef.current = await startSafeHybridQrScanner({
      video: videoRef.current,
      onResult: ({ text }) => {
        setScannedEmployeeId(text.trim());
        setIsScanning(false);
        scannerSessionRef.current?.stop();
        scannerSessionRef.current = null;
      },
      onError: (errorCode) => {
        const descriptions: Record<string, string> = {
          'permission-denied': 'Camera access was denied. Please allow camera permission and try again.',
          'no-camera': 'No camera was found on this device.',
          'camera-unavailable': 'Camera is busy or unavailable. Close other camera apps and try again.',
          unsupported: 'This browser does not support QR scanning on this device.',
          unknown: 'Unable to start QR scanner.',
        };
        setQrError(descriptions[errorCode] ?? descriptions.unknown);
        setIsScanning(false);
      },
    });
  } catch {
    setIsScanning(false);
  }
};
```

Remove the old dynamic ZXing import logic.

- [ ] **Step 3: Run typecheck after guard-login refactor**

Run: `npm run typecheck`
Expected: PASS with no new guard-login scanner type errors.

- [ ] **Step 4: Commit**

```bash
git add /Users/mymac/Documents/CISS/src/app/guard-login/page.tsx
git commit -m "refactor: share guard login qr scanner"
```

### Task 5: Verify scanner behavior end-to-end

**Files:**
- Modify: none unless verification reveals issues
- Test: `/Users/mymac/Documents/CISS/src/lib/qr/scanner-support.test.ts`
- Test: `/Users/mymac/Documents/CISS/src/lib/qr/scanner-engine.test.ts`

- [ ] **Step 1: Run targeted unit tests**

Run: `npx vitest run /Users/mymac/Documents/CISS/src/lib/qr/scanner-support.test.ts /Users/mymac/Documents/CISS/src/lib/qr/scanner-engine.test.ts`
Expected: PASS.

- [ ] **Step 2: Run app typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Start app locally and verify scanner routes load**

Run:

```bash
npm run dev
```

Then confirm these routes load in browser verification:
- `/attendance`
- `/guard-login`

Expected: both pages render, scanner surfaces mount without runtime import errors.

- [ ] **Step 5: Commit final verification fixes if needed**

```bash
git add -A
git commit -m "test: verify hybrid qr scanner integration"
```
