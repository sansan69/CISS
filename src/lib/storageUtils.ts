
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { storage } from "./firebase"; // Use the exported storage instance

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
    image.src = URL.createObjectURL(file);
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
        URL.revokeObjectURL(image.src);
        return reject(new Error('Failed to get canvas context'));
      }
      ctx.drawImage(image, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Canvas to Blob conversion failed'));
          }
        },
        options.targetMimeType || 'image/jpeg', // Default to JPEG for compression
        options.quality
      );
      URL.revokeObjectURL(image.src); 
    };
    image.onerror = (error) => {
      URL.revokeObjectURL(image.src); 
      console.error("Image loading error for compression:", error);
      reject(new Error("Failed to load image for compression."));
    };
  });
}

// Function to upload a file (Blob or File) to Firebase Storage
export async function uploadFileToStorage(
  file: File | Blob,
  storagePath: string
): Promise<string> {
  const storageRef = ref(storage, storagePath);
  const snapshot = await uploadBytes(storageRef, file);
  const downloadURL = await getDownloadURL(snapshot.ref);
  return downloadURL;
}

// New Function to delete a file from Firebase Storage using its download URL
export async function deleteFileFromStorage(fileUrl: string): Promise<void> {
    if (!fileUrl || !fileUrl.startsWith("https://firebasestorage.googleapis.com/")) {
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
