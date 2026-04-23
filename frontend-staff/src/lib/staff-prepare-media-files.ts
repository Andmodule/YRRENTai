import { compressImageFile } from '@/lib/compress-image';

const MAX_STAFF_VERIFICATION_FILES = 10;
/** Align with `STAFF_VERIFICATION_MAX_FILE_BYTES` in backend. */
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export type StaffPrepareMediaResult =
  | { ok: true; files: File[] }
  | { ok: false; error: 'too_many' | 'video_too_large'; maxFiles?: number; maxMb?: number };

/**
 * Up to 10 files: images compressed as JPEG, videos pass through (size-capped).
 */
export async function prepareStaffVerificationFiles(fileList: FileList | File[]): Promise<StaffPrepareMediaResult> {
  const arr = Array.from(fileList);
  if (arr.length > MAX_STAFF_VERIFICATION_FILES) {
    return { ok: false, error: 'too_many', maxFiles: MAX_STAFF_VERIFICATION_FILES };
  }
  const out: File[] = [];
  for (const f of arr) {
    const type = f.type || '';
    if (type.startsWith('video/')) {
      if (f.size > MAX_VIDEO_BYTES) {
        return { ok: false, error: 'video_too_large', maxMb: 50 };
      }
      out.push(f);
      continue;
    }
    if (type.startsWith('image/') || !type) {
      // Canvas/HEIC/WebView часто падает — тогда грузим оригинал, превью и отправка не ломаются.
      try {
        const blob = await compressImageFile(f);
        out.push(
          new File([blob], f.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }),
        );
      } catch {
        out.push(f);
      }
      continue;
    }
    if (f.size > MAX_VIDEO_BYTES) {
      return { ok: false, error: 'video_too_large', maxMb: 50 };
    }
    out.push(f);
  }
  return { ok: true, files: out };
}

export { MAX_STAFF_VERIFICATION_FILES, MAX_VIDEO_BYTES };
