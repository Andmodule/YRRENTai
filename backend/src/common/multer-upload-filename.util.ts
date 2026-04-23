import { extname } from 'path';

/** Multer file shape (avoids `express-serve-static-core` type path quirks). */
type MulterLikeFile = { mimetype?: string; originalname?: string };

/** Extension for a stored public file from multipart upload (image or video). */
export function publicUploadFileExtension(f: MulterLikeFile): string {
  const mt = (f.mimetype || '').toLowerCase();
  if (mt.includes('png')) return 'png';
  if (mt.includes('webp')) return 'webp';
  if (mt.includes('jpeg') || mt === 'image/jpg') return 'jpg';
  if (mt.startsWith('image/')) return 'jpg';
  if (mt.includes('mp4') || f.originalname?.toLowerCase().endsWith('.m4v')) return 'mp4';
  if (mt.includes('webm')) return 'webm';
  if (mt.includes('quicktime')) return 'mov';
  if (mt.startsWith('video/')) return 'mp4';
  const ext = extname(f.originalname || '').replace(/^\./, '').toLowerCase();
  if (ext && /^[a-z0-9]{2,5}$/i.test(ext)) return ext;
  return 'bin';
}

export const STAFF_VERIFICATION_MAX_FILE_BYTES = 50 * 1024 * 1024;
