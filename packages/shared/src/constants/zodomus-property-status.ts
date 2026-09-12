/** Persisted Zodomus channel status for a RentAI property (null = not linked). */
export const ZODOMUS_PROPERTY_STATUSES = [
  'active',
  'evaluation',
  'not_active',
  'invalid',
  'error',
  'unknown',
] as const;

export type ZodomusPropertyStatus = (typeof ZODOMUS_PROPERTY_STATUSES)[number];

export function isZodomusPropertyStatus(value: unknown): value is ZodomusPropertyStatus {
  return (
    typeof value === 'string' &&
    (ZODOMUS_PROPERTY_STATUSES as readonly string[]).includes(value)
  );
}
