import { describe, expect, it, vi } from 'vitest';

import {
  createDuplicateScanGuard,
  deliverScanResultSafely,
  shouldFallbackToZxing,
  startHybridQrScanner,
} from './scanner-engine';

vi.mock('@zxing/browser', () => ({
  BrowserMultiFormatReader: class {
    decodeFromStream = vi.fn().mockRejectedValue(new Error('zxing startup failed'));
  },
}));

describe('createDuplicateScanGuard', () => {
  it('suppresses repeated payloads during the cooldown window', () => {
    const guard = createDuplicateScanGuard(1200);

    expect(guard.accept('EMP001', 1000)).toBe(true);
    expect(guard.accept('EMP001', 1500)).toBe(false);
    expect(guard.accept('EMP001', 2301)).toBe(true);
  });

  it('treats a different payload as new immediately', () => {
    const guard = createDuplicateScanGuard(1200);

    expect(guard.accept('EMP001', 1000)).toBe(true);
    expect(guard.accept('EMP002', 1200)).toBe(true);
  });
});

describe('shouldFallbackToZxing', () => {
  it('falls back when native scanning is unavailable', () => {
    expect(
      shouldFallbackToZxing({
        nativeFailed: false,
        nativeSupported: false,
      }),
    ).toBe(true);
  });

  it('uses native scanning when detector support is present and stream is ready', () => {
    expect(
      shouldFallbackToZxing({
        nativeFailed: false,
        nativeSupported: true,
      }),
    ).toBe(false);
  });

  it('falls back after a native detector failure', () => {
    expect(
      shouldFallbackToZxing({
        nativeFailed: true,
        nativeSupported: true,
      }),
    ).toBe(true);
  });
});

describe('deliverScanResultSafely', () => {
  it('swallows rejected onResult handlers', async () => {
    const onResult = vi.fn().mockRejectedValue(new Error('user handler failed'));

    await expect(
      deliverScanResultSafely({
        backend: 'native',
        deviceId: 'cam-1',
        onResult,
        text: 'EMP001',
      }),
    ).resolves.toBe(false);
    expect(onResult).toHaveBeenCalledTimes(1);
  });
});

describe('startHybridQrScanner fallback cleanup', () => {
  it('cleans up the camera stream when ZXing fallback startup fails', async () => {
    const stop = vi.fn();
    const stream = {
      getTracks: () => [{ stop }],
    } as unknown as MediaStream;
    const video = {
      play: vi.fn().mockResolvedValue(undefined),
      srcObject: null,
      muted: false,
      playsInline: false,
      autoplay: false,
    } as unknown as HTMLVideoElement;

    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: vi.fn().mockResolvedValue([]),
        getUserMedia: vi.fn().mockResolvedValue(stream),
      },
    });
    vi.stubGlobal('BarcodeDetector', undefined);

    await expect(
      startHybridQrScanner({
        video,
        onResult: vi.fn(),
      }),
    ).rejects.toThrow('zxing startup failed');

    expect(stop).toHaveBeenCalledTimes(1);
    expect((video as { srcObject: MediaStream | null }).srcObject).toBeNull();
    vi.unstubAllGlobals();
  });
});
