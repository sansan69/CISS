import type { QrScannerErrorCode } from './scanner-types';

export type BarcodeDetectorResultLike = {
  rawValue?: string | null;
};

export type BarcodeDetectorLike = {
  detect: (source: unknown) => Promise<BarcodeDetectorResultLike[]>;
};

export type BarcodeDetectorConstructorLike = {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

const BACK_CAMERA_PATTERNS = [/back/i, /rear/i, /environment/i, /world/i];
const FRONT_CAMERA_PATTERNS = [/front/i, /user/i, /facetime/i];

function getErrorName(error: unknown): string {
  if (error instanceof DOMException) return error.name;
  if (error instanceof Error) return error.name;
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return '';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '';
}

export async function shouldUseNativeBarcodeDetector(
  Detector: BarcodeDetectorConstructorLike | null | undefined,
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

  const rearCamera = videoInputs.find((device) =>
    BACK_CAMERA_PATTERNS.some((pattern) => pattern.test(device.label)),
  );
  if (rearCamera) return rearCamera;

  const nonFrontCamera = videoInputs.find(
    (device) => !FRONT_CAMERA_PATTERNS.some((pattern) => pattern.test(device.label)),
  );
  if (nonFrontCamera) return nonFrontCamera;

  return videoInputs[0] ?? null;
}

export function isTorchSupported(track: MediaStreamTrack | null | undefined): boolean {
  if (!track || typeof track.getCapabilities !== 'function') return false;

  const capabilities = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
  return capabilities.torch === true;
}

export function normalizeScannerError(error: unknown): QrScannerErrorCode {
  const name = getErrorName(error);
  const message = getErrorMessage(error).toLowerCase();

  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission-denied';
  if (name === 'NotFoundError' || /no camera|camera not found|no device/i.test(message)) {
    return 'no-camera';
  }
  if (name === 'NotReadableError' || name === 'AbortError') return 'camera-unavailable';
  if (name === 'NotSupportedError' || /barcode detector|unsupported/i.test(message)) {
    return 'unsupported';
  }
  if (
    name === 'TypeError' &&
    /barcode detector|media devices|mediadevice|getusermedia|constraints|camera/i.test(message)
  ) {
    return 'unsupported';
  }
  if (/invalid qr|invalid payload|malformed/i.test(message)) return 'invalid-payload';

  return 'unknown';
}
