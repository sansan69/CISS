"use client";

import React, { useRef, useState } from "react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage, auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Camera, User, ImageIcon, X, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PhotoCaptureProps {
  urls: string[];
  onChange: (urls: string[]) => void;
  /** Storage sub-folder: "visitReports" | "trainingReports" */
  folder: string;
  maxPhotos?: number;
  disabled?: boolean;
}

export function PhotoCapture({ urls, onChange, folder, maxPhotos = 10, disabled }: PhotoCaptureProps) {
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
      toast({ title: "Limit reached", description: `Max ${maxPhotos} photos allowed.`, variant: "destructive" });
      return;
    }

    setUploading(true);
    const added: string[] = [];
    try {
      for (const file of Array.from(files).slice(0, slotsLeft)) {
        const path = `foReports/${folder}/${user.uid}/${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
        const snap = await uploadBytes(ref(storage, path), file);
        added.push(await getDownloadURL(snap.ref));
      }
      onChange([...urls, ...added]);
    } catch {
      toast({ title: "Upload failed", description: "Could not upload photo.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const remove = (i: number) => onChange(urls.filter((_, idx) => idx !== i));

  const canAdd = !disabled && !uploading && urls.length < maxPhotos;

  return (
    <div className="space-y-3">
      {/* Hidden file inputs */}
      <input ref={cameraRef}  type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={handleFiles} />
      <input ref={selfieRef}  type="file" accept="image/*" capture="user"        multiple className="hidden" onChange={handleFiles} />
      <input ref={galleryRef} type="file" accept="image/*"                        multiple className="hidden" onChange={handleFiles} />

      {canAdd && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => cameraRef.current?.click()}>
            <Camera className="h-4 w-4 mr-1.5" /> Site Photo
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => selfieRef.current?.click()}>
            <User className="h-4 w-4 mr-1.5" /> Selfie
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => galleryRef.current?.click()}>
            <ImageIcon className="h-4 w-4 mr-1.5" /> Gallery
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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
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
        {urls.length}/{maxPhotos} photos. Use &quot;Site Photo&quot; for back camera, &quot;Selfie&quot; for front camera.
      </p>
    </div>
  );
}
