const buckets = new Map<string, number[]>();

/** Простой sliding window на процесс (один инстанс Next). Для нескольких инстансов нужен общий стор (Redis и т.п.). */
export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const windowStart = now - windowMs;
  const prev = buckets.get(key) ?? [];
  const within = prev.filter((t) => t > windowStart);

  if (within.length >= max) {
    const oldest = within[0]!;
    const retryAfterMs = Math.max(0, oldest + windowMs - now);
    return { ok: false, retryAfterSec: Math.ceil(retryAfterMs / 1000) };
  }

  within.push(now);
  buckets.set(key, within);

  if (buckets.size > 5000) {
    for (const [k, arr] of buckets) {
      const pruned = arr.filter((t) => t > windowStart);
      if (pruned.length === 0) buckets.delete(k);
      else buckets.set(k, pruned);
    }
  }

  return { ok: true };
}
