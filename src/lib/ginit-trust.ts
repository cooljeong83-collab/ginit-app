/**
 * 지닛 신뢰도(gTrust) · 패널티 · 공개 모임 참가 자격(표시·색상·유틸).
 * — Supabase 쪽은 `supabase/migrations/0002_trust_penalty.sql`의 service_role RPC가 권위 원장입니다.
 * — 앱 실시간 UX는 Firestore `users` 문서를 따르며, 운영 백엔드가 양쪽을 동기화하는 것을 권장합니다.
 */
import type { UserProfile } from '@/src/lib/user-profile';

/** 호스트가 '신뢰도 높은 모임'으로 설정할 때 사용하는 최소 gTrust 하한 */
export const GINIT_HIGH_TRUST_HOST_MIN = 70;

// Blue → Indigo → Violet (premium tone)
// - blue-600:   #2563EB
// - indigo-600: #4F46E5
// - violet-600: #7C3AED
const TRUST_BLUE = { r: 37, g: 99, b: 235 };
const TRUST_INDIGO = { r: 79, g: 70, b: 229 };
const TRUST_VIOLET = { r: 124, g: 58, b: 237 };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(from: { r: number; g: number; b: number }, to: { r: number; g: number; b: number }, t: number): string {
  const r = Math.round(lerp(from.r, to.r, t));
  const g = Math.round(lerp(from.g, to.g, t));
  const b = Math.round(lerp(from.b, to.b, t));
  return `rgb(${r},${g},${b})`;
}

export type GinitTrustTierKey = 'excellent' | 'normal' | 'caution' | 'restricted';

export function clampTrust(n: number): number {
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, Math.min(100, Math.trunc(n)));
}

export function effectiveGTrust(profile: UserProfile | null | undefined): number {
  const t = profile?.gTrust;
  return typeof t === 'number' && Number.isFinite(t) ? clampTrust(t) : 100;
}

export function effectiveGXp(profile: UserProfile | null | undefined): number {
  const x = profile?.gXp;
  return typeof x === 'number' && Number.isFinite(x) ? Math.trunc(x) : 0;
}

export function effectiveGLevel(profile: UserProfile | null | undefined): number {
  const lv = profile?.gLevel;
  return typeof lv === 'number' && Number.isFinite(lv) ? Math.max(1, Math.min(50, Math.trunc(lv))) : 1;
}

export function isUserTrustRestricted(profile: UserProfile | null | undefined): boolean {
  return profile?.isRestricted === true;
}

export function isHighTrustPublicMeeting(cfg: { minGTrust?: number | null } | null | undefined): boolean {
  const m = cfg?.minGTrust;
  return typeof m === 'number' && Number.isFinite(m) && m >= GINIT_HIGH_TRUST_HOST_MIN;
}

/** 레벨 진행 바 채움색: 신뢰 0→100을 blue→indigo→violet로 보간 */
export function levelBarFillColorForTrust(trust: number): string {
  const t = clampTrust(trust) / 100;
  if (t <= 0.5) {
    return lerpRgb(TRUST_BLUE, TRUST_INDIGO, t / 0.5);
  }
  return lerpRgb(TRUST_INDIGO, TRUST_VIOLET, (t - 0.5) / 0.5);
}

export function trustTierForUser(profile: UserProfile | null | undefined): {
  key: GinitTrustTierKey;
  label: string;
  trust: number;
} {
  const trust = effectiveGTrust(profile);
  if (profile?.isRestricted === true || trust < 30) {
    return { key: 'restricted', label: '제한', trust };
  }
  if (trust < 50) return { key: 'caution', label: '주의', trust };
  if (trust < 80) return { key: 'normal', label: '보통', trust };
  return { key: 'excellent', label: '우수', trust };
}

/** 다음 레벨까지 필요한 XP (간단 곡선; 서버와 불일치 시 서버 기준으로 맞추면 됨) */
export function xpProgressWithinLevel(profile: UserProfile | null | undefined): { ratio: number; currentXp: number; nextAt: number } {
  const lv = effectiveGLevel(profile);
  const xp = Math.max(0, effectiveGXp(profile));
  const floor = (lv - 1) * 200;
  const nextAt = lv * 200;
  const span = Math.max(1, nextAt - floor);
  const ratio = Math.max(0, Math.min(1, (xp - floor) / span));
  return { ratio, currentXp: xp, nextAt };
}

export function formatReportApprovedTrustMessage(): string {
  return '운영 정책에 따라 신고가 승인되어 신뢰 점수(gTrust)가 감점되었습니다. 약속 이행으로 신뢰를 회복할 수 있어요.';
}
