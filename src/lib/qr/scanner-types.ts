export type QrScannerBackend = 'native' | 'zxing';

export type QrScannerErrorCode =
  | 'permission-denied'
  | 'no-camera'
  | 'camera-unavailable'
  | 'unsupported'
  | 'invalid-payload'
  | 'unknown';

export type QrScannerStatus = 'idle' | 'starting' | 'scanning' | 'stopped' | 'error';

export type QrScanResult = {
  text: string;
  backend: QrScannerBackend;
  scannedAt: number;
  deviceId?: string;
};

export type QrScannerSession = {
  stop: () => void;
  getBackend: () => QrScannerBackend | null;
  getDeviceId: () => string | null;
};

