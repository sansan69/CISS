
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { storage } from "./firebase"; // Use the exported storage instance

const DEFAULT_IMAGE_COMPRESSION_OPTIONS = {
  maxWidth: 1024,
  maxHeight: 1024,
  quality: 0.7,
  targetMimeType: "image/jpeg",
} as const;

const COMPRESSIBLE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

const MIME_TYPE_TO_EXTENSION: Record<string, string> = {
  "application/pdf": "pdf",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const ENROLLMENT_IMAGE_ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif";

export const ENROLLMENT_DOCUMENT_ACCEPT = `${ENROLLMENT_IMAGE_ACCEPT},application/pdf,.pdf`;

// Function to convert a data URL to a File object
export async function dataURLtoFile(dataurl: string, filename: string): Promise<File> {
  const res = await fetch(dataurl);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type });
}

// Function to compress an image client-side
export async function compressImage(
  file: File,
  options: { maxWidth: number; maxHeight: number; quality: number; targetMimeType?: string }
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      resolve(file); 
      return;
    }

    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.src = objectUrl;
    image.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = image;

      if (width > options.maxWidth) {
        height = Math.round((height * options.maxWidth) / width);
        width = options.maxWidth;
      }
      if (height > options.maxHeight) {
        width = Math.round((width * options.maxHeight) / height);
        height = options.maxHeight;
      }
      
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        return reject(new Error('Failed to get canvas context'));
      }
      ctx.drawImage(image, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            URL.revokeObjectURL(objectUrl);
            resolve(blob);
          } else {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Canvas to Blob conversion failed'));
          }
        },
        options.targetMimeType || 'image/jpeg', // Default to JPEG for compression
        options.quality
      );
    };
    image.onerror = (error) => {
      URL.revokeObjectURL(objectUrl);
      console.error("Image loading error for compression:", error);
      reject(new Error("Failed to load image for compression."));
    };
  });
}

function getExtensionFromName(fileName?: string): string | null {
  if (!fileName || !fileName.includes(".")) {
    return null;
  }

  const extension = fileName.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  return extension || null;
}

export function getUploadFileExtension(file: Blob | File, fallback = "bin"): string {
  const mimeType = file.type?.toLowerCase();
  if (mimeType && MIME_TYPE_TO_EXTENSION[mimeType]) {
    return MIME_TYPE_TO_EXTENSION[mimeType];
  }

  if ("name" in file) {
    const extensionFromName = getExtensionFromName(file.name);
    if (extensionFromName) {
      return extensionFromName;
    }
  }

  return fallback;
}

function replaceFileExtension(fileName: string, extension: string): string {
  const baseName = fileName.includes(".")
    ? fileName.slice(0, fileName.lastIndexOf("."))
    : fileName;

  return `${baseName}.${extension}`;
}

export async function prepareFileForUpload(
  file: File,
  options: Partial<typeof DEFAULT_IMAGE_COMPRESSION_OPTIONS> = {}
): Promise<File> {
  if (!file.type.startsWith("image/")) {
    return file;
  }

  const normalizedMimeType = file.type.toLowerCase();
  if (!COMPRESSIBLE_IMAGE_TYPES.has(normalizedMimeType)) {
    return file;
  }

  const resolvedOptions = { ...DEFAULT_IMAGE_COMPRESSION_OPTIONS, ...options };

  try {
    const compressedBlob = await compressImage(file, resolvedOptions);

    if (!compressedBlob.size || compressedBlob.size >= file.size) {
      return file;
    }

    const extension = getUploadFileExtension(
      new File([compressedBlob], "compressed", { type: compressedBlob.type }),
      "jpg",
    );

    return new File(
      [compressedBlob],
      replaceFileExtension(file.name, extension),
      {
        lastModified: file.lastModified,
        type: compressedBlob.type || resolvedOptions.targetMimeType,
      },
    );
  } catch (error) {
    console.warn("Image compression failed, falling back to original file:", error);
    return file;
  }
}

// Function to upload a file (Blob or File) to Firebase Storage
export async function uploadFileToStorage(
  file: File | Blob,
  storagePath: string
): Promise<string> {
  const storageRef = ref(storage, storagePath);
  const snapshot = await uploadBytes(storageRef, file, {
    contentType: file.type || undefined,
  });
  const downloadURL = await getDownloadURL(snapshot.ref);
  return downloadURL;
}

// New Function to delete a file from Firebase Storage using its download URL
export async function deleteFileFromStorage(fileUrl: string): Promise<void> {
    if (!fileUrl || (!fileUrl.startsWith("https://") && !fileUrl.startsWith("gs://"))) {
      console.warn("Invalid or empty file URL, skipping deletion:", fileUrl);
      return;
    }
    try {
      // The Firebase Storage SDK can accept the full gs:// or https:// URL directly in ref()
      const storageRef = ref(storage, fileUrl);
      await deleteObject(storageRef);
      console.log(`Successfully deleted file: ${fileUrl}`);
    } catch (error: any) {
      if (error.code === 'storage/object-not-found') {
        console.warn(`Could not delete file because it was not found. This may happen if it was already deleted or the URL is incorrect. URL: ${fileUrl}`);
      } else {
        // Log the error but don't re-throw, to allow the parent update operation to continue.
        console.error(`Error deleting existing file from storage. URL: ${fileUrl}`, error);
      }
    }
  }
