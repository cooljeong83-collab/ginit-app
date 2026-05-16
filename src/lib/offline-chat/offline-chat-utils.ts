import type { Timestamp } from '@/src/lib/ginit-timestamp';

/**
 * WatermelonDB(SQLite)·Hermes JSI로 넘길 때 U+0000·고아 UTF-16 서로게이트로
 * `string_error: problem while parsing a string` 가 나는 경우를 줄입니다.
 */
export function sanitizeUnicodeForSqliteStorage(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return input;
  const noNul = input.includes('\u0000') ? input.replace(/\u0000/g, '') : input;
  let out = '';
  for (let i = 0; i < noNul.length; i += 1) {
    const c = noNul.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < noNul.length ? noNul.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += noNul[i] + noNul[i + 1];
        i += 1;
      } else {
        out += '\uFFFD';
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out += '\uFFFD';
    } else {
      out += noNul[i];
    }
  }
  return out;
}

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

export function buildSearchText(parts: (string | null | undefined)[]): string {
  const out = parts
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .join(' ');
  const joined = out.length > 8000 ? out.slice(0, 8000) : out;
  return sanitizeUnicodeForSqliteStorage(joined);
}

