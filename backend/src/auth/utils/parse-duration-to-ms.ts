const MULTIPLIERS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDurationToMs(value: string, fallbackMs: number): number {
  const trimmed = value.trim();
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(trimmed);
  if (!match?.[1] || !match[2]) {
    return fallbackMs;
  }
  const amount = parseInt(match[1], 10);
  const unit = match[2] as keyof typeof MULTIPLIERS;
  const mult = MULTIPLIERS[unit];
  return mult !== undefined ? amount * mult : fallbackMs;
}
