import { describe, expect, it } from 'vitest';

import {
  choosePreferredVideoInput,
  isTorchSupported,
  normalizeScannerError,
  shouldUseNativeBarcodeDetector,
} from './scanner-support';

describe('shouldUseNativeBarcodeDetector', () => {
  it('returns true when BarcodeDetector supports qr_code', async () => {
    const nativeDetector = class {
      static async getSupportedFormats() {
        return ['qr_code', 'ean_13'];
      }
    };

    await expect(shouldUseNativeBarcodeDetector(nativeDetector as never)).resolves.toBe(true);
  });

  it('returns false when qr_code is not supported', async () => {
    const nativeDetector = class {
      static async getSupportedFormats() {
        return ['ean_13'];
      }
    };

    await expect(shouldUseNativeBarcodeDetector(nativeDetector as never)).resolves.toBe(false);
  });
});

describe('choosePreferredVideoInput', () => {
  it('prefers back-facing camera labels', () => {
    const devices = [
      { deviceId: 'front', kind: 'videoinput', label: 'Front Camera' },
      { deviceId: 'rear', kind: 'videoinput', label: 'Back Camera' },
    ] as MediaDeviceInfo[];

    expect(choosePreferredVideoInput(devices)?.deviceId).toBe('rear');
  });

  it('falls back to the first videoinput when labels are unavailable', () => {
    const devices = [{ deviceId: 'only', kind: 'videoinput', label: '' }] as MediaDeviceInfo[];

    expect(choosePreferredVideoInput(devices)?.deviceId).toBe('only');
  });
});

describe('isTorchSupported', () => {
  it('returns true only when track capabilities expose torch', () => {
    const track = {
      getCapabilities: () => ({ torch: true }),
    } as unknown as MediaStreamTrack;

    expect(isTorchSupported(track)).toBe(true);
  });

  it('returns false when torch is not exposed', () => {
    const track = {
      getCapabilities: () => ({}),
    } as unknown as MediaStreamTrack;

    expect(isTorchSupported(track)).toBe(false);
  });
});

describe('normalizeScannerError', () => {
  it('maps permission errors to permission-denied', () => {
    const error = new DOMException('Permission denied', 'NotAllowedError');
    expect(normalizeScannerError(error)).toBe('permission-denied');
  });

  it('maps missing device errors to no-camera', () => {
    const error = new DOMException('No camera found', 'NotFoundError');
    expect(normalizeScannerError(error)).toBe('no-camera');
  });

  it('does not broadly classify generic TypeError values as unsupported', () => {
    const error = new TypeError('boom');
    expect(normalizeScannerError(error)).toBe('unknown');
  });
});
