
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
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
      // If it's not an image, return it as is (or handle as error if strict image compression is needed)
      // For this use case, we might be passing PDFs through, so let's resolve the original file if not image
      resolve(file); // Or reject(new Error('File is not an image and cannot be compressed'));
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
