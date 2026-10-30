'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { airbnbApi, type AirbnbJob, type AirbnbListingView } from './api';

export const airbnbKeys = {
  status: ['airbnb', 'status'] as const,
  connected: ['airbnb', 'connected'] as const,
  listings: ['airbnb', 'listings'] as const,
  listing: (propertyId: string) => ['airbnb', 'listing', propertyId] as const,
};

/** The «Airbnb» page is the owner's, and only while the server has Airbnb switched on (ZODOMUS_AIRBNB_ENABLED). */
export function useAirbnbAccess() {
  const { user, isLoading } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const status = useQuery({
    queryKey: airbnbKeys.status,
    queryFn: airbnbApi.status,
    enabled: isOwner,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return { isOwner, authLoading: isLoading, enabled: isOwner && status.data?.enabled === true, status };
}

/** The property the pilot listing is connected to — the page opens on it. */
export function useAirbnbConnectedProperty(enabled: boolean) {
  return useQuery({ queryKey: airbnbKeys.connected, queryFn: airbnbApi.connectedProperty, enabled, retry: false, staleTime: 60_000 });
}

/** The pilot listing of a property; polled every 2 s while a check / send runs, else every minute (the check expires). */
export function useAirbnbListing(propertyId: string | null) {
  return useQuery({
    queryKey: airbnbKeys.listing(propertyId ?? ''),
    queryFn: () => airbnbApi.listing(propertyId!),
    enabled: !!propertyId,
    retry: false,
    refetchInterval: (q) => (q.state.data?.job?.state === 'running' ? 2_000 : 60_000),
  });
}

export function useAirbnbMutations(propertyId: string | null) {
  const qc = useQueryClient();
  const setStatus = (v: Awaited<ReturnType<typeof airbnbApi.status>>) => qc.setQueryData(airbnbKeys.status, v);
  // The started job goes into the cache at once: the buttons lock and polling starts without waiting for a refetch.
  const startedJob = (job: AirbnbJob) => {
    if (!propertyId) return;
    qc.setQueryData<AirbnbListingView>(airbnbKeys.listing(propertyId), (old) => (old ? { ...old, job, freshPlan: null } : old));
    void qc.invalidateQueries({ queryKey: airbnbKeys.listing(propertyId) });
    void qc.invalidateQueries({ queryKey: airbnbKeys.connected });
  };
  return {
    activateHost: useMutation({ mutationFn: airbnbApi.activateHost, onSuccess: setStatus }),
    refreshHost: useMutation({ mutationFn: airbnbApi.refreshHost, onSuccess: setStatus }),
    listings: useMutation({ mutationFn: airbnbApi.listings, onSuccess: (v) => qc.setQueryData(airbnbKeys.listings, v) }),
    check: useMutation({ mutationFn: () => airbnbApi.check(propertyId!), onSuccess: startedJob }),
    connect: useMutation({ mutationFn: (fingerprint: string) => airbnbApi.connect(propertyId!, fingerprint), onSuccess: startedJob }),
    send: useMutation({ mutationFn: (fingerprint: string) => airbnbApi.send(propertyId!, fingerprint), onSuccess: startedJob }),
  };
}
