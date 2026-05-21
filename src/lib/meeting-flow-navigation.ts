import type { Href, Router } from 'expo-router';

import { safeRouterBack, type ExpoRouterLike } from '@/src/lib/router-safe';

/** 모임 정산·후기 플로우 종료 시 복귀 허용 경로 */
export type MeetingFlowReturnTo =
  | '/(tabs)'
  | '/(tabs)/chat'
  | `/meeting/${string}`
  | `/meeting-chat/${string}`;

const TAB_RETURN_PATHS = new Set<string>(['/(tabs)', '/(tabs)/chat']);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeReturnToRaw(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim();
}

/**
 * `returnTo` 쿼리/params 화이트리스트 검증. 잘못된 값은 `/(tabs)`로 폴백합니다.
 */
export function sanitizeMeetingFlowReturnTo(
  raw: unknown,
  fallback: MeetingFlowReturnTo = '/(tabs)',
): MeetingFlowReturnTo {
  const value = normalizeReturnToRaw(raw);
  if (!value) return fallback;
  if (TAB_RETURN_PATHS.has(value)) return value as MeetingFlowReturnTo;
  const meetingMatch = /^\/meeting\/([^/]+)$/.exec(value);
  if (meetingMatch && UUID_RE.test(meetingMatch[1])) {
    return `/meeting/${meetingMatch[1]}` as MeetingFlowReturnTo;
  }
  const chatMatch = /^\/meeting-chat\/([^/]+)$/.exec(value);
  if (chatMatch && UUID_RE.test(chatMatch[1])) {
    return `/meeting-chat/${chatMatch[1]}` as MeetingFlowReturnTo;
  }
  return fallback;
}

export function readReturnToFromParams(
  params: Record<string, unknown> | { returnTo?: string | string[] },
  fallback: MeetingFlowReturnTo = '/(tabs)',
): MeetingFlowReturnTo {
  const raw = (params as { returnTo?: string | string[] }).returnTo;
  const single = Array.isArray(raw) ? raw[0] : raw;
  return sanitizeMeetingFlowReturnTo(single, fallback);
}

export function meetingDetailReturnTo(meetingId: string): MeetingFlowReturnTo {
  const id = meetingId.trim();
  return `/meeting/${id}` as MeetingFlowReturnTo;
}

export function meetingChatReturnTo(meetingId: string): MeetingFlowReturnTo {
  const id = meetingId.trim();
  return `/meeting-chat/${id}` as MeetingFlowReturnTo;
}

export type MeetingFlowRouteTarget =
  | { kind: 'settlement'; meetingId: string }
  | { kind: 'meeting-review'; meetingId: string };

/** 탐색 피드 모임 후기 캐러셀(목록)에서 summary 화면으로 진입 */
export const MEETING_REVIEW_ENTRY_FEED_LIST = 'feed_review_list' as const;

export type MeetingReviewEntry = typeof MEETING_REVIEW_ENTRY_FEED_LIST;

const MEETING_REVIEW_ENTRY_VALUES = new Set<string>([MEETING_REVIEW_ENTRY_FEED_LIST]);

export function readMeetingReviewEntryFromParams(
  params: Record<string, unknown> | { entry?: string | string[] },
): MeetingReviewEntry | null {
  const raw = (params as { entry?: string | string[] }).entry;
  const single = Array.isArray(raw) ? raw[0] : raw;
  const value = typeof single === 'string' ? single.trim() : '';
  if (!value || !MEETING_REVIEW_ENTRY_VALUES.has(value)) return null;
  return value as MeetingReviewEntry;
}

export function buildMeetingDetailHref(
  meetingId: string,
  returnTo: MeetingFlowReturnTo = '/(tabs)',
): Href {
  const id = meetingId.trim();
  return {
    pathname: `/meeting/${encodeURIComponent(id)}`,
    params: { returnTo: sanitizeMeetingFlowReturnTo(returnTo) },
  } as Href;
}

export type BuildMeetingFlowHrefOptions = {
  /** `meeting-review` 전용 — 탐색 피드 후기 목록 등 진입 출처 */
  reviewEntry?: MeetingReviewEntry;
};

export function buildMeetingFlowHref(
  target: MeetingFlowRouteTarget,
  returnTo: MeetingFlowReturnTo,
  options?: BuildMeetingFlowHrefOptions,
): Href {
  const meetingId = target.meetingId.trim();
  const safeReturn = sanitizeMeetingFlowReturnTo(returnTo);
  const pathname =
    target.kind === 'settlement'
      ? `/settlement/${encodeURIComponent(meetingId)}`
      : `/meeting-review/${encodeURIComponent(meetingId)}`;
  const params: { returnTo: MeetingFlowReturnTo; entry?: MeetingReviewEntry } = {
    returnTo: safeReturn,
  };
  if (target.kind === 'meeting-review' && options?.reviewEntry) {
    params.entry = options.reviewEntry;
  }
  return {
    pathname,
    params,
  } as Href;
}

function tryDismissTo(router: Router, href: MeetingFlowReturnTo): void {
  router.dismissTo(href as Href);
}

/**
 * 후기 써머리 등 플로우 종료 시 `returnTo`까지 스택을 정리합니다.
 * `dismissTo` 실패 시 `/(tabs)` → `safeRouterBack` 순으로 폴백합니다.
 */
export function exitMeetingReviewFlow(
  router: Router & ExpoRouterLike,
  returnTo: unknown,
  opts?: { fallback?: MeetingFlowReturnTo },
): void {
  const fallback = opts?.fallback ?? '/(tabs)';
  const primary = sanitizeMeetingFlowReturnTo(returnTo, fallback);
  try {
    tryDismissTo(router, primary);
    return;
  } catch {
    /* fall through */
  }
  if (primary !== '/(tabs)') {
    try {
      tryDismissTo(router, '/(tabs)');
      return;
    } catch {
      /* fall through */
    }
  }
  safeRouterBack(router);
}
