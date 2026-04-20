'use client';

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

/**
 * Typed URL search-param state — persists across reload/back/forward.
 * Only string values; use coercion in consumers.
 */
export type UrlStateSchema = Record<string, string | undefined>;

type SetUrlState<T extends UrlStateSchema> = (
  updates: Partial<T>,
  opts?: { replace?: boolean },
) => void;

export function useUrlState<T extends UrlStateSchema>(
  defaults: T,
): [T, SetUrlState<T>] {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Read current state (merge defaults with URL params)
  const state = useMemo(() => {
    const result = { ...defaults } as T;
    for (const key of Object.keys(defaults)) {
      const val = searchParams.get(key);
      if (val !== null) (result as Record<string, string | undefined>)[key] = val;
    }
    return result;
  }, [searchParams, defaults]);

  const setState: SetUrlState<T> = useCallback(
    (updates, opts) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        const defVal = defaults[key];
        if (value === undefined || value === '' || value === defVal) {
          params.delete(key);
        } else {
          params.set(key, value as string);
        }
      }
      const query = params.toString();
      const url = query ? `${pathname}?${query}` : pathname;
      if (opts?.replace) {
        router.replace(url, { scroll: false });
      } else {
        router.push(url, { scroll: false });
      }
    },
    [searchParams, router, pathname, defaults],
  );

  return [state, setState];
}
