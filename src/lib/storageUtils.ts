
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "./firebase"; // Use the exported storage instance

// Function to compress an image client-side
export async function compressImage(
  file: File,
  options: { maxWidth: number; maxHeight: number; quality: number }
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.src = URL.createObjectURL(file);
    image.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = image;

      // Calculate new dimensions while maintaining aspect ratio
      if (width > options.maxWidth) {
        height = Math.round((height * options.maxWidth) / width);
        width = options.maxWidth;
      }
      if (height > options.maxHeight) { // Check maxHeight after width adjustment
        width = Math.round((width * options.maxHeight) / height);
        height = options.maxHeight;
      }
      
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
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
        'image/jpeg', // Always output as JPEG for compression
        options.quality
      );
      URL.revokeObjectURL(image.src); // Clean up object URL
    };
    image.onerror = (error) => {
      URL.revokeObjectURL(image.src); // Clean up object URL
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
  // console.log(`Uploading to: ${storagePath}`);
  const snapshot = await uploadBytes(storageRef, file);
  const downloadURL = await getDownloadURL(snapshot.ref);
  // console.log(`Uploaded ${storagePath}, URL: ${downloadURL}`);
  return downloadURL;
}
