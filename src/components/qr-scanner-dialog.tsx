"use client";

import React, { useRef, useEffect, useCallback } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { QrCode, ScanLine, Loader2 } from 'lucide-react';
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
  const generationRef = useRef(0);

  const stopScanner = useCallback(() => {
    generationRef.current += 1;
    sessionRef.current?.stop();
    sessionRef.current = null;
    scanLockedRef.current = false;
  }, []);

  useEffect(() => {
    if (!open) {
      stopScanner();
      return;
    }

    const gen = generationRef.current;
    const video = videoRef.current;
    if (!video) return;

    let started = false;

    const start = async () => {
      try {
        const session = await startHybridQrScanner({
          video,
          onResult: async ({ text }) => {
            if (scanLockedRef.current) return;
            scanLockedRef.current = true;
            stopScanner();
            onOpenChange(false);
            onScan(text);
          },
          onError: (errorCode) => {
            console.error('QR scanner error:', errorCode);
          },
        });

        if (gen !== generationRef.current) {
          session.stop();
          return;
        }

        sessionRef.current = session;
        started = true;
      } catch (e: any) {
        console.error('Scanner failed:', e);
      }
    };

    start();

    return () => {
      if (!started && sessionRef.current) {
        sessionRef.current.stop();
        sessionRef.current = null;
      }
      stopScanner();
    };
  }, [open, onScan, onOpenChange, stopScanner]);

  return (
    <Dialog open={open} onOpenChange={(val) => { if (!val) { stopScanner(); onOpenChange(false); } }}>
      <DialogContent className="sm:max-w-sm p-0 gap-0 bg-black border-white/20">
        <div className="relative w-full aspect-square overflow-hidden rounded-t-lg bg-black">
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            muted
            playsInline
          />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-3/5 h-3/5 border-2 border-white/70 rounded-2xl relative shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]">
              <ScanLine className="absolute -top-3 left-1/2 -translate-x-1/2 h-5 w-5 text-brand-gold animate-bounce" />
            </div>
          </div>
          {!sessionRef.current && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/70 bg-black/40">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">Starting camera...</p>
            </div>
          )}
        </div>
        <div className="p-4 text-center text-sm text-white/60">
          <QrCode className="inline-block h-4 w-4 mr-1.5 text-brand-gold" />
          Hold your CISS QR card in front of the camera
        </div>
      </DialogContent>
    </Dialog>
  );
}
