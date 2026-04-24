import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

import type { Meeting } from '@/src/lib/meetings';

/** 2026 홈 글래스 스펙 — Trust Blue / Energetic Orange */
export const HOME_TRUST_BLUE = '#0052CC';
export const HOME_ORANGE = '#FF8A00';

export type HomeIonName = ComponentProps<typeof Ionicons>['name'];

export type HomeCategoryVisual = {
  icon: HomeIonName;
  gradient: readonly [string, string];
};

const KEYWORD_ROWS: { keys: string[]; visual: HomeCategoryVisual }[] = [
  {
    keys: ['영화', 'movie', 'film'],
    visual: { icon: 'film-outline', gradient: ['rgba(99, 102, 241, 0.45)', 'rgba(236, 72, 153, 0.28)'] as const },
  },
  {
    keys: ['운동', 'fitness', 'gym', '러닝', '헬스'],
    visual: { icon: 'barbell-outline', gradient: ['rgba(16, 185, 129, 0.42)', 'rgba(0, 82, 204, 0.25)'] as const },
  },
  {
    keys: ['맛집', '식사', 'food', 'brunch', '카페', '술'],
    visual: { icon: 'restaurant-outline', gradient: ['rgba(251, 146, 60, 0.45)', 'rgba(239, 68, 68, 0.22)'] as const },
  },
  {
    keys: ['독서', '북', 'book'],
    visual: { icon: 'book-outline', gradient: ['rgba(59, 130, 246, 0.38)', 'rgba(147, 197, 253, 0.2)'] as const },
  },
  {
    keys: ['음악', 'music', '콘서트'],
    visual: { icon: 'musical-notes-outline', gradient: ['rgba(168, 85, 247, 0.4)', 'rgba(236, 72, 153, 0.22)'] as const },
  },
  {
    keys: ['산책', 'walk', 'outdoor', '등산'],
    visual: { icon: 'walk-outline', gradient: ['rgba(34, 197, 94, 0.38)', 'rgba(14, 165, 233, 0.22)'] as const },
  },
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** 카테고리 라벨·id 기반 아이콘 + 그라데이션(사진 대체) */
export function getHomeCategoryVisual(m: Meeting): HomeCategoryVisual {
  const label = (m.categoryLabel ?? '').toLowerCase();
  const id = (m.categoryId ?? '').toLowerCase();
  const hay = `${label} ${id}`;
  for (const row of KEYWORD_ROWS) {
    if (row.keys.some((k) => hay.includes(k.toLowerCase()))) return row.visual;
  }
  const h = hashString(`${m.categoryId ?? ''}-${m.categoryLabel ?? ''}`);
  const alt: HomeCategoryVisual[] = [
    { icon: 'sparkles-outline', gradient: ['rgba(0, 82, 204, 0.35)', 'rgba(255, 138, 0, 0.22)'] as const },
    { icon: 'planet-outline', gradient: ['rgba(0, 82, 204, 0.4)', 'rgba(56, 189, 248, 0.2)'] as const },
    { icon: 'layers-outline', gradient: ['rgba(255, 138, 0, 0.35)', 'rgba(0, 82, 204, 0.22)'] as const },
    { icon: 'color-palette-outline', gradient: ['rgba(244, 114, 182, 0.35)', 'rgba(99, 102, 241, 0.22)'] as const },
  ];
  return alt[h % alt.length];
}

function seoulYmdFromMs(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ms);
}

/** 서울 기준 내일 날짜 `YYYY-MM-DD` (한국 DST 없음, +24h 근사) */
export function seoulTomorrowYmd(): string {
  return seoulYmdFromMs(Date.now() + 24 * 60 * 60 * 1000);
}

export function meetingIsTomorrowInSeoul(m: Meeting): boolean {
  const d = m.scheduleDate?.trim();
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return d === seoulTomorrowYmd();
}

export function homeMeetingStatusBadgeLabel(m: Meeting): string {
  if (meetingIsTomorrowInSeoul(m)) return '내일 모임';
  if (m.scheduleConfirmed === true) return '확정';
  return '조율 중';
}

/** 참가자 id → gLevel 대용 컬러(프로필 미조회 시 시각적 구분) */
const GLEVEL_LIKE_PALETTE = [
  '#0052CC',
  '#FF8A00',
  '#10B981',
  '#A855F7',
  '#EC4899',
  '#0EA5E9',
  '#EAB308',
  '#F97316',
] as const;

export function gLevelLikeColorForUserId(userId: string): string {
  const h = hashString(userId.trim());
  return GLEVEL_LIKE_PALETTE[h % GLEVEL_LIKE_PALETTE.length];
}

export function meetingParticipantIdsForStack(m: Meeting, max = 5): string[] {
  const host = m.createdBy?.trim() ?? '';
  const raw = m.participantIds ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    const t = id.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  if (host) push(host);
  for (const x of raw) push(String(x));
  return out.slice(0, max);
}
