import type { ResendWebhookDto } from './dto/resend-webhook.dto';

/**
 * Canonical id for webhook-level idempotency (Resend receiving API / event id).
 * Prefer `email_id`; fallback to top-level `id` on `data` when present.
 */
export function extractResendWebhookEventId(data: ResendWebhookDto['data']): string | null {
  const d = data as { id?: string; email_id?: string };
  const id = (d.email_id ?? d.id)?.trim();
  return id || null;
}
