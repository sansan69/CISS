"use client";

import React, { useRef, useState, useCallback } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { QrCode, ScanLine, Loader2, AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { startHybridQrScanner } from '@/lib/qr/scanner-engine';
import { normalizeScannerError } from '@/lib/qr/scanner-support';
import type { QrScannerSession } from '@/lib/qr/scanner-types';

type QrScannerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (text: string) => void;
};

export function QrScannerDialog({ open, onOpenChange, onScan }: QrScannerDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<QrScannerSession | null>(null);
  const scanLockedRef = useRef(false);
  const [cameraState, setCameraState] = useState<'idle' | 'starting' | 'scanning' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const stopScanner = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    scanLockedRef.current = false;
  }, []);

  const startScanner = useCallback(async () => {
    const video = videoRef.current;
    if (!video) {
      setCameraState('error');
      setErrorMessage('Camera not available. Please try again.');
      return;
    }

    setCameraState('starting');
    setErrorMessage('');

    try {
      const session = await startHybridQrScanner({
        video,
        onResult: async ({ text }) => {
          if (scanLockedRef.current) return;
          scanLockedRef.current = true;
          stopScanner();
          setCameraState('idle');
          onOpenChange(false);
          onScan(text);
        },
        onError: () => {},
      });

      sessionRef.current = session;
      setCameraState('scanning');
    } catch (e: any) {
      const code = normalizeScannerError(e);
      const messages: Record<string, string> = {
        'permission-denied': 'Camera permission was denied. Allow camera access in your browser settings and try again.',
        'no-camera': 'No camera was found on this device.',
        'camera-unavailable': 'The camera is currently unavailable.',
        unsupported: 'Your browser does not support QR scanning.',
      };
      setErrorMessage(messages[code] || 'Could not start camera. Please try again.');
      setCameraState('error');
    }
  }, [onScan, onOpenChange, stopScanner]);

  const handleOpenChange = useCallback((val: boolean) => {
    if (!val) {
      stopScanner();
      setCameraState('idle');
      setErrorMessage('');
    }
    onOpenChange(val);
  }, [onOpenChange, stopScanner]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-sm p-0 gap-0 bg-black border-white/20"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          void startScanner();
        }}
      >
        <div className="relative w-full aspect-square overflow-hidden rounded-t-lg bg-black">
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            muted
            playsInline
          />

          {/* Scan overlay frame */}
          {cameraState === 'scanning' && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-3/5 h-3/5 border-2 border-white/70 rounded-2xl relative shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]">
                <ScanLine className="absolute -top-3 left-1/2 -translate-x-1/2 h-5 w-5 text-brand-gold animate-bounce" />
              </div>
            </div>
          )}

          {/* Starting state */}
          {cameraState === 'starting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/70 bg-black/40">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">Starting camera...</p>
            </div>
          )}

          {/* Error state */}
          {cameraState === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/80 bg-black/60 p-6 text-center">
              <AlertTriangle className="h-10 w-10 text-brand-gold" />
              <p className="text-sm leading-relaxed">{errorMessage}</p>
            </div>
          )}

          {/* Idle / not started */}
          {cameraState === 'idle' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/60 bg-black/40">
              <QrCode className="h-14 w-14" />
              <p className="text-sm">Preparing QR scanner...</p>
            </div>
          )}
        </div>

        <div className="p-4 text-center text-sm text-white/60 space-y-2">
          {cameraState === 'error' ? (
            <Button
              variant="outline"
              size="sm"
              className="border-white/20 text-white/70 hover:bg-white/10 hover:text-white"
              onClick={() => void startScanner()}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Try again
            </Button>
          ) : (
            <p>
              <QrCode className="inline-block h-4 w-4 mr-1.5 text-brand-gold" />
              Hold your CISS QR card in front of the camera
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
