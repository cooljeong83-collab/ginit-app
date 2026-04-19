import { Timestamp } from 'firebase/firestore';

/** 휠·폼에서 온 값을 안전한 정수로 (Firestore undefined 방지). */
export function toFiniteInt(n: unknown, fallback: number): number {
  if (typeof n === 'string') {
    const p = Number.parseInt(n.trim(), 10);
    return Number.isFinite(p) ? p : fallback;
  }
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.trunc(x);
}

/**
 * Firestore에 넣기 전 중첩 객체·배열에서 `undefined` 제거.
 * `Timestamp` 등 Firestore 네이티브 타입은 그대로 둡니다.
 */
export function stripUndefinedDeep(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'object') return value;
  if (value instanceof Timestamp) return value;
  if (Array.isArray(value)) {
    return (value.map(stripUndefinedDeep).filter((v) => v !== undefined) as unknown[]);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) {
    return value;
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const inner = stripUndefinedDeep(v);
    if (inner === undefined) continue;
    out[k] = inner;
  }
  return out;
}

/** `console.log`용 — Timestamp 등을 직렬화 가능한 형태로. */
export function toJsonSafeFirestorePreview(payload: unknown): string {
  try {
    return JSON.stringify(
      payload,
      (_key, val) => {
        if (val instanceof Timestamp) {
          return { __firestore: 'Timestamp', seconds: val.seconds, nanoseconds: val.nanoseconds };
        }
        return val;
      },
      2,
    );
  } catch (e) {
    return `[JSON.stringify failed: ${e instanceof Error ? e.message : String(e)}]`;
  }
}
