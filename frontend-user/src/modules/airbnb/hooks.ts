'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { airbnbApi } from './api';

export const airbnbKeys = {
  status: ['airbnb', 'status'] as const,
  listings: ['airbnb', 'listings'] as const,
  listing: (propertyId: string) => ['airbnb', 'listing', propertyId] as const,
};

/** The «Airbnb» page is the owner's, and only while the server has Airbnb switched on (ZODOMUS_AIRBNB_ENABLED). */
export function useAirbnbAccess() {
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const status = useQuery({
    queryKey: airbnbKeys.status,
    queryFn: airbnbApi.status,
    enabled: isOwner,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return { isOwner, enabled: isOwner && status.data?.enabled === true, status };
}

/** The pilot listing of a property; polled every 2 s while a check / send runs. */
export function useAirbnbListing(propertyId: string | null) {
  return useQuery({
    queryKey: airbnbKeys.listing(propertyId ?? ''),
    queryFn: () => airbnbApi.listing(propertyId!),
    enabled: !!propertyId,
    retry: false,
    refetchInterval: (q) => (q.state.data?.job?.state === 'running' ? 2_000 : false),
  });
}

export function useAirbnbMutations(propertyId: string | null) {
  const qc = useQueryClient();
  const setStatus = (v: Awaited<ReturnType<typeof airbnbApi.status>>) => qc.setQueryData(airbnbKeys.status, v);
  const refreshListing = () => {
    if (propertyId) void qc.invalidateQueries({ queryKey: airbnbKeys.listing(propertyId) });
  };
  return {
    activateHost: useMutation({ mutationFn: airbnbApi.activateHost, onSuccess: setStatus }),
    refreshHost: useMutation({ mutationFn: airbnbApi.refreshHost, onSuccess: setStatus }),
    listings: useMutation({ mutationFn: airbnbApi.listings, onSuccess: (v) => qc.setQueryData(airbnbKeys.listings, v) }),
    check: useMutation({ mutationFn: () => airbnbApi.check(propertyId!), onSuccess: refreshListing }),
    connect: useMutation({ mutationFn: (fingerprint: string) => airbnbApi.connect(propertyId!, fingerprint), onSuccess: refreshListing }),
    send: useMutation({ mutationFn: (fingerprint: string) => airbnbApi.send(propertyId!, fingerprint), onSuccess: refreshListing }),
  };
}
