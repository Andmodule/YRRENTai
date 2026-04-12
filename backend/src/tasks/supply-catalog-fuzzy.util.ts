/** Расстояние Левенштейна (короткие строки номенклатуры). */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + c);
    }
  }
  return dp[m]![n]!;
}

/** Макс. допустимое расстояние для нечёткого сопоставления. */
export function maxFuzzyDistanceForLength(len: number): number {
  if (len <= 5) return 1;
  if (len <= 14) return 2;
  if (len <= 28) return 3;
  return 4;
}
