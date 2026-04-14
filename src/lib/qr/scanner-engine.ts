import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

import type {
  BarcodeDetectorConstructorLike,
  BarcodeDetectorLike,
} from './scanner-support';
import {
  choosePreferredVideoInput,
  normalizeScannerError,
  shouldUseNativeBarcodeDetector,
} from './scanner-support';
import type {
  QrScanResult,
  QrScannerBackend,
  QrScannerErrorCode,
  QrScannerSession,
} from './scanner-types';

type DuplicateScanGuard = {
  accept: (text: string, now?: number) => boolean;
  reset: () => void;
};

type HybridScannerOptions = {
  video: HTMLVideoElement;
  cooldownMs?: number;
  onResult: (result: QrScanResult) => void | Promise<void>;
  onError?: (error: QrScannerErrorCode) => void;
};

type ScannerControlsLike = {
  stop: () => void;
};

type CameraSelection = {
  deviceId: string | null;
  useFacingModeFallback: boolean;
};

const NATIVE_SCAN_INTERVAL_MS = 120;

type DeliveredScanResult = {
  backend: QrScannerBackend;
  deviceId?: string;
  onResult: (result: QrScanResult) => void | Promise<void>;
  text: string;
};

export function createDuplicateScanGuard(cooldownMs: number): DuplicateScanGuard {
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
}): boolean {
  return !nativeSupported || nativeFailed;
}

export async function deliverScanResultSafely({
  backend,
  deviceId,
  onResult,
  text,
}: DeliveredScanResult): Promise<boolean> {
  try {
    await onResult({
      text,
      backend,
      scannedAt: Date.now(),
      deviceId,
    });
    return true;
  } catch {
    return false;
  }
}

function getBarcodeDetectorCtor(): BarcodeDetectorConstructorLike | null {
  if (typeof globalThis === 'undefined') return null;
  const maybeDetector = (globalThis as typeof globalThis & {
    BarcodeDetector?: BarcodeDetectorConstructorLike;
  }).BarcodeDetector;
  return maybeDetector ?? null;
}

async function chooseCameraSelection(): Promise<CameraSelection> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return { deviceId: null, useFacingModeFallback: true };
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const preferred = choosePreferredVideoInput(devices);
    if (!preferred) {
      return { deviceId: null, useFacingModeFallback: true };
    }

    const hasUsefulLabel = preferred.label.trim().length > 0;
    return {
      deviceId: hasUsefulLabel ? preferred.deviceId : null,
      useFacingModeFallback: !hasUsefulLabel,
    };
  } catch {
    return { deviceId: null, useFacingModeFallback: true };
  }
}

async function openVideoStream(selection: CameraSelection): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new DOMException('Media devices are unavailable.', 'NotSupportedError');
  }

  const constraints: MediaStreamConstraints = selection.deviceId
    ? {
        audio: false,
        video: {
          deviceId: { ideal: selection.deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      }
    : {
        audio: false,
        video: selection.useFacingModeFallback
          ? { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 } },
      };

  return navigator.mediaDevices.getUserMedia(constraints);
}

function setVideoSource(video: HTMLVideoElement, stream: MediaStream) {
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
}

function clearVideoSource(video: HTMLVideoElement, stream: MediaStream) {
  if (video.srcObject === stream) {
    video.srcObject = null;
  }
}

async function startNativeScanLoop({
  detector,
  video,
  duplicateGuard,
  onResult,
  preferredDeviceId,
  onFailure,
  stopSignal,
}: {
  detector: BarcodeDetectorLike;
  video: HTMLVideoElement;
  duplicateGuard: DuplicateScanGuard;
  onResult: (result: QrScanResult) => void | Promise<void>;
  preferredDeviceId: string | null;
  onFailure: () => void;
  stopSignal: { stopped: boolean; nativeFailed: boolean };
}): Promise<void> {
  const step = async () => {
    if (stopSignal.stopped || stopSignal.nativeFailed) return;

    try {
      const results = await detector.detect(video);
      const text = results[0]?.rawValue?.trim();
      if (text && duplicateGuard.accept(text)) {
        await deliverScanResultSafely({
          backend: 'native',
          deviceId: preferredDeviceId ?? undefined,
          onResult,
          text,
        });
      }
    } catch (error) {
      stopSignal.nativeFailed = true;
      onFailure();
      return;
    }

    if (!stopSignal.stopped && !stopSignal.nativeFailed) {
      window.setTimeout(() => {
        void step();
      }, NATIVE_SCAN_INTERVAL_MS);
    }
  };

  await step();
}

async function startZxingScanLoop({
  stream,
  video,
  duplicateGuard,
  onResult,
  preferredDeviceId,
}: {
  stream: MediaStream;
  video: HTMLVideoElement;
  duplicateGuard: DuplicateScanGuard;
  onResult: (result: QrScanResult) => void | Promise<void>;
  preferredDeviceId: string | null;
}): Promise<ScannerControlsLike> {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
  hints.set(DecodeHintType.TRY_HARDER, true);

  const reader = new BrowserMultiFormatReader(hints);
  return reader.decodeFromStream(stream, video, async (result) => {
    const text = result?.getText()?.trim();
    if (!text || !duplicateGuard.accept(text)) return;

    await deliverScanResultSafely({
      backend: 'zxing',
      deviceId: preferredDeviceId ?? undefined,
      onResult,
      text,
    });
  });
}

export async function startHybridQrScanner({
  video,
  cooldownMs = 1200,
  onResult,
  onError,
}: HybridScannerOptions): Promise<QrScannerSession> {
  if (typeof window === 'undefined') {
    throw new DOMException('QR scanner requires a browser environment.', 'NotSupportedError');
  }

  const duplicateGuard = createDuplicateScanGuard(cooldownMs);
  const selection = await chooseCameraSelection();
  const stream = await openVideoStream(selection);
  let backend: QrScannerBackend | null = null;
  let nativeTimerStopped = false;
  let nativeFailed = false;
  let zxingControls: ScannerControlsLike | null = null;
  let fallbackStarted = false;

  const stop = () => {
    nativeTimerStopped = true;
    zxingControls?.stop();
    zxingControls = null;
    duplicateGuard.reset();
    stream.getTracks().forEach((track) => track.stop());
    clearVideoSource(video, stream);
    backend = null;
  };

  const startFallbackToZxing = async () => {
    if (fallbackStarted || nativeTimerStopped) return;
    fallbackStarted = true;
    nativeFailed = true;
    try {
      zxingControls = await startZxingScanLoop({
        stream,
        video,
        duplicateGuard,
        onResult,
        preferredDeviceId: selection.deviceId,
      });
      backend = 'zxing';
    } catch (error) {
      backend = null;
      stop();
      throw error;
    }
  };

  setVideoSource(video, stream);
  await video.play().catch(() => undefined);

  const detectorCtor = getBarcodeDetectorCtor();
  const nativeSupported = await shouldUseNativeBarcodeDetector(detectorCtor);

  if (nativeSupported && detectorCtor) {
    try {
      const detector = new detectorCtor({ formats: ['qr_code'] });
      backend = 'native';
      void startNativeScanLoop({
        detector,
        video,
        duplicateGuard,
        onResult,
        preferredDeviceId: selection.deviceId,
        onFailure: () => {
          void startFallbackToZxing().catch((error) => {
            onError?.(normalizeScannerError(error));
          });
        },
        stopSignal: {
          get stopped() {
            return nativeTimerStopped;
          },
          set stopped(next) {
            nativeTimerStopped = next;
          },
          get nativeFailed() {
            return nativeFailed;
          },
          set nativeFailed(next) {
            nativeFailed = next;
          },
        },
      }).catch((error) => {
        nativeFailed = true;
        onError?.(normalizeScannerError(error));
        void startFallbackToZxing().catch((fallbackError) => {
          onError?.(normalizeScannerError(fallbackError));
        });
      });
    } catch {
      nativeFailed = true;
      await startFallbackToZxing();
    }
  }

  if (shouldFallbackToZxing({ nativeSupported, nativeFailed }) && !fallbackStarted) {
    await startFallbackToZxing();
  }

  return {
    stop,
    getBackend: () => backend,
    getDeviceId: () => selection.deviceId,
  };
}

export async function startSafeHybridQrScanner(options: HybridScannerOptions): Promise<QrScannerSession> {
  try {
    return await startHybridQrScanner(options);
  } catch (error) {
    options.onError?.(normalizeScannerError(error));
    throw error;
  }
}
