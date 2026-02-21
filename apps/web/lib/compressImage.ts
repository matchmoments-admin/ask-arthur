import imageCompression from "browser-image-compression";

const MAX_SIZE_KB = 500;
const MAX_SIZE_BYTES = MAX_SIZE_KB * 1024;
const MAX_DIMENSION = 1920;

export async function compressImage(file: File): Promise<File> {
  // Skip non-image files
  if (!file.type.startsWith("image/")) {
    return file;
  }

  // Skip files already under target size
  if (file.size <= MAX_SIZE_BYTES) {
    return file;
  }

  try {
    const compressed = await imageCompression(file, {
      maxSizeMB: MAX_SIZE_KB / 1024,
      maxWidthOrHeight: MAX_DIMENSION,
      useWebWorker: true,
      fileType: "image/webp",
      exifOrientation: undefined, // auto-correct then strip
    });

    // If compression made it larger, return original
    if (compressed.size >= file.size) {
      return file;
    }

    return compressed;
  } catch {
    // Fall back to original on any error
    return file;
  }
}
