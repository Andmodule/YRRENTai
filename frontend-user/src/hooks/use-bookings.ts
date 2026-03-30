import useSWR from 'swr';
import { fetcher } from '@/lib/api/fetcher';

interface Booking {
  id: string;
  propertyId: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  status: string;
  totalPriceMinor: number;
  currency: string;
}

interface BookingsResponse {
  data: Booking[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function useBookings(propertyId: string | null, page = 1) {
  const { data, error, isLoading, mutate } = useSWR<BookingsResponse>(
    propertyId ? `/bookings?propertyId=${propertyId}&page=${page}` : null,
    fetcher,
  );

  return {
    bookings: data?.data,
    meta: data?.meta,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}
