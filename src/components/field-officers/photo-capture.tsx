"use client";

import React, { useRef, useState } from "react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage, auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Camera, User, ImageIcon, X, Loader2, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const INDIA_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  dateStyle: "medium",
  timeStyle: "medium",
});

interface PhotoCaptureProps {
  urls: string[];
  onChange: (urls: string[]) => void;
  /** Storage sub-folder: "visitReports" | "trainingReports" | "trainingReportFiles" */
  folder: string;
  maxPhotos?: number;
  disabled?: boolean;
  /** Accepted formats: images and PDFs */
  accept?: string;
  timestampImages?: boolean;
  stampTitle?: string;
  stampLines?: string[];
  allowCamera?: boolean;
  allowSelfie?: boolean;
  uploadLabel?: string;
  fileTypeLabel?: string;
  /** Capture device GPS location and include in timestamp overlay */
  captureLocation?: boolean;
  /** Called with GPS coordinates after they are captured */
  onLocationCaptured?: (pos: { lat: number; lng: number } | null) => void;
}

async function getCurrentPosition(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 30000,
      });
    });
    return {
      lat: Math.round(pos.coords.latitude * 10000) / 10000,
      lng: Math.round(pos.coords.longitude * 10000) / 10000,
    };
  } catch {
    return null;
  }
}

async function loadImage(file: File) {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.src = objectUrl;

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Photo could not be prepared."));
    });
    return { image, objectUrl };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function createTimestampedPhoto(file: File, title: string, lines: string[], locationLines?: string[]) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only photos can be timestamped. Please choose an image file.");
  }

  const capturedAt = new Date();
  const { image, objectUrl } = await loadImage(file);

  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Photo canvas is unavailable.");
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const overlayX = 24;
    const overlayWidth = canvas.width - 48;
    const overlayHeight = Math.max(170, Math.round(canvas.height * 0.22));
    const overlayY = canvas.height - overlayHeight - 24;
    const radius = 24;

    context.fillStyle = "rgba(8, 14, 30, 0.72)";
    context.beginPath();
    context.moveTo(overlayX + radius, overlayY);
    context.lineTo(overlayX + overlayWidth - radius, overlayY);
    context.quadraticCurveTo(overlayX + overlayWidth, overlayY, overlayX + overlayWidth, overlayY + radius);
    context.lineTo(overlayX + overlayWidth, overlayY + overlayHeight - radius);
    context.quadraticCurveTo(overlayX + overlayWidth, overlayY + overlayHeight, overlayX + overlayWidth - radius, overlayY + overlayHeight);
    context.lineTo(overlayX + radius, overlayY + overlayHeight);
    context.quadraticCurveTo(overlayX, overlayY + overlayHeight, overlayX, overlayY + overlayHeight - radius);
    context.lineTo(overlayX, overlayY + radius);
    context.quadraticCurveTo(overlayX, overlayY, overlayX + radius, overlayY);
    context.closePath();
    context.fill();

    const safeLines = [
      title,
      ...lines.filter((line) => line.trim()),
      ...(locationLines ?? []).filter((line) => line.trim()),
      `Captured at ${INDIA_DATE_TIME_FORMATTER.format(capturedAt)}`,
      "Captured by CISS Field Officer",
    ].slice(0, 8);

    let cursorY = overlayY + 48;
    safeLines.forEach((line, index) => {
      context.fillStyle = index === 0 ? "#FFFFFF" : "rgba(255,255,255,0.92)";
      context.font = `${index === 0 ? 700 : 500} ${index === 0 ? Math.max(24, Math.round(canvas.width * 0.03)) : Math.max(17, Math.round(canvas.width * 0.02))}px Arial`;
      context.fillText(line, overlayX + 28, cursorY, overlayWidth - 56);
      cursorY += index === 0 ? 38 : 29;
    });

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((nextBlob) => {
        if (nextBlob) {
          resolve(nextBlob);
        } else {
          reject(new Error("Photo timestamp could not be applied."));
        }
      }, "image/jpeg", 0.92);
    });

    const baseName = file.name.includes(".") ? file.name.slice(0, file.name.lastIndexOf(".")) : file.name;
    return new File([blob], `${baseName}_timestamped.jpg`, {
      type: "image/jpeg",
      lastModified: capturedAt.getTime(),
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function PhotoCapture({
  urls,
  onChange,
  folder,
  maxPhotos = 10,
  disabled,
  accept = "image/*,.pdf",
  timestampImages = false,
  stampTitle = "Field officer photo",
  stampLines = [],
  allowCamera = true,
  allowSelfie = true,
  uploadLabel = "Upload",
  fileTypeLabel = "JPG, PNG, PDF allowed.",
  captureLocation = false,
  onLocationCaptured,
}: PhotoCaptureProps) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);

  const cameraRef = useRef<HTMLInputElement>(null);
  const selfieRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.target.value = ""; // reset so same file can be re-selected
    if (!files || files.length === 0) return;

    const user = auth.currentUser;
    if (!user) {
      toast({ title: "Not authenticated", variant: "destructive" });
      return;
    }

    const slotsLeft = maxPhotos - urls.length;
    if (slotsLeft <= 0) {
      toast({ title: "Limit reached", description: `Max ${maxPhotos} files allowed.`, variant: "destructive" });
      return;
    }

    setUploading(true);
    const added: string[] = [];
    const errors: string[] = [];

    // Capture GPS location once for all photos in this batch (if enabled)
    const pos = captureLocation ? await getCurrentPosition() : null;
    if (pos) onLocationCaptured?.(pos);
    const locationLines = pos ? [`GPS ${pos.lat}, ${pos.lng}`] : undefined;

    try {
      for (const file of Array.from(files).slice(0, slotsLeft)) {
        try {
          const timestamp = Date.now();
          const uploadFile = timestampImages
            ? await createTimestampedPhoto(file, stampTitle, stampLines, locationLines)
            : file;
          const path = `foReports/${folder}/${user.uid}/${timestamp}_${uploadFile.name.replace(/\s+/g, "_")}`;
          const snap = await uploadBytes(ref(storage, path), uploadFile, {
            contentType: uploadFile.type || undefined,
          });
          // Retry getDownloadURL up to 3 times (transient token/network issues)
          let url: string | null = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              url = await getDownloadURL(snap.ref);
              break;
            } catch (e) {
              if (attempt === 2) throw e;
              await new Promise(r => setTimeout(r, 1000));
            }
          }
          if (url) added.push(url);
        } catch (fileErr: any) {
          console.error('File upload failed:', fileErr);
          errors.push(fileErr?.message || 'Upload failed');
        }
      }
      // Persist successfully uploaded URLs even if some files failed
      if (added.length > 0) {
        onChange([...urls, ...added]);
      }
      if (errors.length > 0) {
        toast({
          title: errors.length === 1 ? "1 file failed" : `${errors.length} files failed`,
          description: `${added.length} uploaded. ${errors.join('; ')}`,
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error('Upload failed:', err);
      toast({ title: "Upload failed", description: "Could not upload file.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const remove = (i: number) => onChange(urls.filter((_, idx) => idx !== i));
  const isPdfUrl = (url: string) => decodeURIComponent(url).toLowerCase().includes(".pdf");

  const canAdd = !disabled && !uploading && urls.length < maxPhotos;

  return (
    <div className="space-y-3">
      {/* Hidden file inputs */}
      <input ref={cameraRef}  type="file" accept={accept} capture="environment" multiple className="hidden" onChange={handleFiles} />
      <input ref={selfieRef}  type="file" accept={accept} capture="user"        multiple className="hidden" onChange={handleFiles} />
      <input ref={galleryRef} type="file" accept={accept}                         multiple className="hidden" onChange={handleFiles} />

{canAdd && (
        <div className="flex flex-wrap gap-2">
          {allowCamera && (
            <Button type="button" variant="outline" size="sm" onClick={() => cameraRef.current?.click()}>
              <Camera className="h-4 w-4 mr-1.5" /> Camera
            </Button>
          )}
          {allowSelfie && (
            <Button type="button" variant="outline" size="sm" onClick={() => selfieRef.current?.click()}>
              <User className="h-4 w-4 mr-1.5" /> Selfie
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => galleryRef.current?.click()}>
            <ImageIcon className="h-4 w-4 mr-1.5" /> {uploadLabel}
          </Button>
        </div>
      )}

      {uploading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
        </div>
      )}

      {urls.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {urls.map((url, i) => (
            <div key={i} className="relative h-20 w-20 rounded-md overflow-hidden border bg-muted shrink-0">
              {isPdfUrl(url) ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground"
                >
                  <FileText className="h-6 w-6" />
                  PDF
                </a>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt={`File ${i + 1}`} className="h-full w-full object-cover" />
              )}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5 hover:bg-black/80"
                >
                  <X className="h-3 w-3 text-white" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {urls.length}/{maxPhotos} files. {fileTypeLabel} {timestampImages ? "Photos are timestamped automatically." : ""}
      </p>
    </div>
  );
}
