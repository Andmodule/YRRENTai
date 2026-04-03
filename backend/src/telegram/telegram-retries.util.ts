/** Small delay helper for inline retries when Redis queue is not used. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts: number; delayMs: (attemptIndex: number) => number },
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < opts.maxAttempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < opts.maxAttempts - 1) {
        await sleep(opts.delayMs(i));
      }
    }
  }
  throw last;
}
