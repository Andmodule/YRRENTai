/** Query keys for task / incident detail — dashboard board + TMA (shared «back» stack). */
export const TASK_DETAIL_URL_QUERY = 'task';
export const TASK_INCIDENT_URL_QUERY = 'incident';

/** Manager dashboard: default | `supply` | `staff-messages`. */
export const TASK_MANAGER_PANEL_QUERY = 'panel';

/** Deep-link: scroll to a supply interpretation card on the supply tab. */
export const TASK_MANAGER_SUPPLY_EVENT_QUERY = 'supplyEvent';

/** Task detail: scroll/focus staff notes block (`staff-notes`). */
export const TASK_DETAIL_FOCUS_QUERY = 'focus';
export const TASK_DETAIL_FOCUS_STAFF_NOTES = 'staff-notes';

/** Staff messages tab: filter query keys. */
export const TASK_STAFF_MSG_UNREAD_QUERY = 'msgUnread';
export const TASK_STAFF_MSG_ASSIGNEE_QUERY = 'msgAssignee';
/** Query value for tasks without assignee in staff-messages filter. */
export const TASK_STAFF_MSG_ASSIGNEE_UNASSIGNED = '__unassigned__';

export function isStaffMessagesQueryFiltered(searchParams: URLSearchParams): boolean {
  return (
    searchParams.get(TASK_STAFF_MSG_UNREAD_QUERY) === '1' ||
    Boolean(searchParams.get(TASK_STAFF_MSG_ASSIGNEE_QUERY)?.trim())
  );
}
