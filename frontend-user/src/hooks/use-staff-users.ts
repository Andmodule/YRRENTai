import useSWR from 'swr';
import { fetcher } from '@/lib/api/fetcher';
import type { StaffMember } from '@/modules/tasks/types';

/**
 * Returns STAFF/MANAGER users linked to the current owner's account.
 * Used to populate the assignee selector in task creation/editing.
 */
export function useStaffUsers() {
  const { data, error, isLoading } = useSWR<StaffMember[]>('/users/staff', fetcher);

  return {
    staff: data ?? [],
    isLoading,
    isError: !!error,
  };
}
