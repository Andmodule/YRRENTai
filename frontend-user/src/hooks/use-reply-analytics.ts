import useSWR from 'swr';
import { fetcher } from '@/lib/api/fetcher';
import type { ReplyAnalyticsPayload } from '@rentai/shared';

export function useReplyAnalytics(range: { from: Date; to: Date } | null) {
  const key = range
    ? `/chats/analytics/reply-stats?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`
    : null;
  return useSWR<ReplyAnalyticsPayload>(key, fetcher);
}
