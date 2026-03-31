import useSWR from 'swr';
import { fetcher } from '@/lib/api/fetcher';

export interface Booking {
  id: string;
  propertyId: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  status: string;
  totalPriceMinor: number;
  currency: string;
}

export function useBookings(propertyId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<Booking[]>(
    propertyId ? `/bookings?propertyId=${encodeURIComponent(propertyId)}` : null,
    fetcher,
  );

  return {
    bookings: data ?? [],
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}
