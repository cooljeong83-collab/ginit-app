import type { Router } from 'expo-router';

export type MemberReviewCompletePayload = {
  meetingId: string;
  placeKey: string;
  placeName: string;
};

type Listener = (p: MemberReviewCompletePayload) => void;

const listeners = new Set<Listener>();

/**
 * 멤버 리뷰 UI에서 저장/완료 직후 호출합니다.
 * `app/meeting-chat/[meetingId]/index` 등에서 구독해 `replace`로 장소 리뷰 화면으로 전환합니다.
 */
export function dispatchMemberReviewComplete(payload: MemberReviewCompletePayload) {
  const p: MemberReviewCompletePayload = {
    meetingId: payload.meetingId.trim(),
    placeKey: payload.placeKey.trim(),
    placeName: payload.placeName.trim(),
  };
  if (!p.meetingId || !p.placeKey) return;
  listeners.forEach((fn) => {
    try {
      fn(p);
    } catch {
      /* ignore */
    }
  });
}

export function subscribeMemberReviewComplete(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 오버랩·블러 없이 장소 리뷰 화면으로 하드 전환 */
export function replaceWithPlaceReviewScreen(router: Pick<Router, 'replace'>, p: MemberReviewCompletePayload) {
  router.replace({
    pathname: '/place-review',
    params: {
      meetingId: p.meetingId.trim(),
      placeKey: p.placeKey.trim(),
      placeName: p.placeName.trim(),
    },
  } as never);
}
