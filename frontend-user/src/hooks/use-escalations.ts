import useSWR from 'swr';
import { fetcher } from '@/lib/api/fetcher';

export interface Escalation {
  id: string;
  propertyId: string;
  propertyName: string;
  guestMessageId?: string;
  guestQuestion: string;
  staffReply: string;
  resolvedAt: string;
  createdAt: string;
}

/** Matches API body after fetcher unwraps axios `response.data.data` */
interface EscalationsPayload {
  escalations: Escalation[];
  total: number;
  days: number;
}

export function useEscalations(propertyId: string | null, days = 30) {
  const { data, error, isLoading, mutate } = useSWR<EscalationsPayload>(
    propertyId
      ? `/telegram/properties/${propertyId}/escalations?days=${days}`
      : null,
    fetcher,
  );

  return {
    escalations: data?.escalations ?? [],
    total: data?.total ?? 0,
    days: data?.days ?? days,
    isLoading,
    isError: !!error,
    mutate,
  };
}
