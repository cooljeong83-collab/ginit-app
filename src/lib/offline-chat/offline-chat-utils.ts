import type { Timestamp } from 'firebase/firestore';

export function tsToMs(ts: unknown): number {
  const t = ts as Timestamp | null | undefined;
  if (t && typeof (t as any).toMillis === 'function') {
    try {
      return (t as any).toMillis();
    } catch {
      return 0;
    }
  }
  if (typeof ts === 'number' && Number.isFinite(ts)) return Math.max(0, ts);
  return 0;
}

export function buildSearchText(parts: Array<string | null | undefined>): string {
  const out = parts
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .join(' ');
  return out.length > 8000 ? out.slice(0, 8000) : out;
}

