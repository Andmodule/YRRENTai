import * as crypto from 'crypto';

/**
 * Verifies a Retell webhook HMAC-SHA256 signature.
 *
 * Retell signs the raw request body with the webhook secret.
 * Header: `x-retell-signature` (hex digest).
 *
 * @param rawBody   - Raw buffer of the request body
 * @param signature - Value from `x-retell-signature` header
 * @param secret    - Signing secret (RETELL_WEBHOOK_SECRET or RETELL_API_KEY as fallback)
 * @returns true if signature is valid, false otherwise
 */
export function verifyRetellSignature(
  rawBody: Buffer,
  signature: string,
  secret: string,
): boolean {
  if (!secret || !signature) return false;
  try {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(signature, 'utf8'),
    );
  } catch {
    return false;
  }
}

/**
 * Returns a masked version of an API key for safe logging.
 * Shows first 4 and last 4 characters only.
 */
export function maskSecret(value: string | undefined): string {
  if (!value || value.length < 8) return '[not set]';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
