/** Public task/incident attachment URLs (path ends with known video ext). */
export function isVideoAttachmentUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);
}
