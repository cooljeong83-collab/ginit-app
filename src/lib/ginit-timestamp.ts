/**
 * 예전 Firestore `Timestamp` / `serverTimestamp` / 구독 해제 타입을 대체합니다.
 * (Firebase JS SDK 의존 제거 — UI·원장 JSON과 동일한 millis 기반)
 */
export type Unsubscribe = () => void;

export class Timestamp {
  readonly seconds: number;
  readonly nanoseconds: number;

  private constructor(seconds: number, nanoseconds: number) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }

  toMillis(): number {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1_000_000);
  }

  toDate(): Date {
    return new Date(this.toMillis());
  }

  static fromMillis(millis: number): Timestamp {
    const ms = Math.floor(Number(millis));
    if (!Number.isFinite(ms)) return Timestamp.fromDate(new Date());
    const seconds = Math.floor(ms / 1000);
    const nanoseconds = (ms % 1000) * 1_000_000;
    return new Timestamp(seconds, nanoseconds);
  }

  static fromDate(date: Date): Timestamp {
    const t = date.getTime();
    return Timestamp.fromMillis(Number.isFinite(t) ? t : Date.now());
  }

  static now(): Timestamp {
    return Timestamp.fromMillis(Date.now());
  }
}

/** Supabase RPC·JSON 직렬화 시 `tsToIsoOrNull` 등에서 인식하는 서버시각 플레이스홀더 */
export function serverTimestamp(): { _methodName: string } {
  return { _methodName: 'serverTimestamp' };
}
