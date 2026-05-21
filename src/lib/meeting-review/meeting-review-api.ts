import { supabase } from '@/src/lib/supabase';

export type MeetingReviewSummaryParticipant = {
  appUserId: string;
  displayName: string;
  avatarUrl: string | null;
  hasReviewed: boolean;
};

export type MeetingReviewKeywordStat = {
  keyword: string;
  count: number;
};

export type MeetingReviewSummaryComment = {
  displayName: string;
  comment: string;
  createdAt: string;
};

export type MeetingReviewSummaryItem = {
  appUserId: string;
  displayName: string;
  avatarUrl: string | null;
  rating: number;
  selectedKeywords: string[];
  comment: string | null;
  createdAt: string;
};

export type MeetingReviewMyReview = {
  rating: number;
  selectedKeywords: string[];
  comment: string | null;
};

export type MeetingReviewSummary = {
  averageRating: number;
  reviewCount: number;
  participants: MeetingReviewSummaryParticipant[];
  keywordStats: MeetingReviewKeywordStat[];
  /** 참여자별 후기(별점·키워드·코멘트) */
  reviews: MeetingReviewSummaryItem[];
  /** 레거시 — 코멘트만 있는 행 */
  comments: MeetingReviewSummaryComment[];
  myReview: MeetingReviewMyReview | null;
};

export type MeetingReviewSubmitPayload = {
  meetingId: string;
  appUserId: string;
  /** 레거시 UUID — 스냅샷 없을 때만 */
  placeId?: string | null;
  placeKey: string;
  placeName: string;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  category?: string | null;
  naverPlaceLink?: string | null;
  preferredPhotoMediaUrl?: string | null;
  rating: number;
  selectedKeywords: string[];
  comment?: string | null;
};

export type MeetingPlaceReviewSubmitResult = {
  placeId: string | null;
  rewardsApplied: boolean;
  xpGranted: number;
  trustGranted: number;
};

function parseSubmitResult(data: unknown): MeetingPlaceReviewSubmitResult {
  const o = (data ?? {}) as Record<string, unknown>;
  const placeId =
    typeof o.place_id === 'string' && o.place_id.trim() ? o.place_id.trim() : null;
  return {
    placeId,
    rewardsApplied: o.rewards_applied === true,
    xpGranted: typeof o.xp_granted === 'number' ? o.xp_granted : Number(o.xp_granted) || 0,
    trustGranted:
      typeof o.trust_granted === 'number' ? o.trust_granted : Number(o.trust_granted) || 0,
  };
}

function mapReviewApiError(message: string): string {
  const m = message.trim().toLowerCase();
  if (m.includes('meeting_not_settled')) return '정산이 완료된 모임에서만 리뷰를 남길 수 있어요.';
  if (m.includes('not_a_meeting_participant')) return '모임 참여자만 리뷰를 남길 수 있어요.';
  if (m.includes('meeting_not_found') || m.includes('invalid_meeting_id')) {
    return '모임을 찾을 수 없어요.';
  }
  if (m.includes('too_many_keywords')) return '키워드는 최대 3개까지 선택할 수 있어요.';
  if (m.includes('invalid_keyword')) return '선택할 수 없는 키워드가 포함되어 있어요.';
  if (m.includes('invalid_rating')) return '별점은 1~5점 사이로 선택해 주세요.';
  if (m.includes('place_id_required')) return '장소 정보가 없어 리뷰를 남길 수 없어요.';
  if (m.includes('app_user_id_required')) return '로그인이 필요해요.';
  return message.trim() || '리뷰 처리에 실패했어요.';
}

function parseSummaryRow(data: unknown): MeetingReviewSummary {
  const o = (data ?? {}) as Record<string, unknown>;
  const participantsRaw = Array.isArray(o.participants) ? o.participants : [];
  const keywordRaw = Array.isArray(o.keyword_stats) ? o.keyword_stats : [];
  const commentsRaw = Array.isArray(o.comments) ? o.comments : [];
  const reviewsRaw = Array.isArray(o.reviews) ? o.reviews : [];

  const myRaw = o.my_review;
  let myReview: MeetingReviewMyReview | null = null;
  if (myRaw && typeof myRaw === 'object' && !Array.isArray(myRaw)) {
    const mr = myRaw as Record<string, unknown>;
    const rating = typeof mr.rating === 'number' ? mr.rating : Number(mr.rating);
    const kwRaw = Array.isArray(mr.selected_keywords) ? mr.selected_keywords : [];
    if (Number.isFinite(rating) && rating >= 1 && rating <= 5) {
      myReview = {
        rating,
        selectedKeywords: kwRaw.filter((k): k is string => typeof k === 'string' && k.trim().length > 0),
        comment: typeof mr.comment === 'string' && mr.comment.trim() ? mr.comment.trim() : null,
      };
    }
  }

  return {
    averageRating: typeof o.average_rating === 'number' ? o.average_rating : Number(o.average_rating) || 0,
    reviewCount: typeof o.review_count === 'number' ? o.review_count : Number(o.review_count) || 0,
    myReview,
    participants: participantsRaw.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        appUserId: typeof r.app_user_id === 'string' ? r.app_user_id : '',
        displayName: typeof r.display_name === 'string' ? r.display_name : '회원',
        avatarUrl: typeof r.avatar_url === 'string' && r.avatar_url.trim() ? r.avatar_url.trim() : null,
        hasReviewed: r.has_reviewed === true,
      };
    }),
    keywordStats: keywordRaw.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        keyword: typeof r.keyword === 'string' ? r.keyword : '',
        count: typeof r.count === 'number' ? r.count : Number(r.count) || 0,
      };
    }),
    reviews: reviewsRaw
      .map((row) => {
        const r = row as Record<string, unknown>;
        const rating = typeof r.rating === 'number' ? r.rating : Number(r.rating);
        if (!Number.isFinite(rating) || rating < 1 || rating > 5) return null;
        const kwRaw = Array.isArray(r.selected_keywords) ? r.selected_keywords : [];
        const commentRaw = typeof r.comment === 'string' ? r.comment.trim() : '';
        return {
          appUserId: typeof r.app_user_id === 'string' ? r.app_user_id : '',
          displayName: typeof r.display_name === 'string' ? r.display_name : '회원',
          avatarUrl:
            typeof r.avatar_url === 'string' && r.avatar_url.trim() ? r.avatar_url.trim() : null,
          rating,
          selectedKeywords: kwRaw.filter((k): k is string => typeof k === 'string' && k.trim().length > 0),
          comment: commentRaw || null,
          createdAt: typeof r.created_at === 'string' ? r.created_at : '',
        } satisfies MeetingReviewSummaryItem;
      })
      .filter((item): item is MeetingReviewSummaryItem => item != null),
    comments: commentsRaw.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        displayName: typeof r.display_name === 'string' ? r.display_name : '회원',
        comment: typeof r.comment === 'string' ? r.comment : '',
        createdAt: typeof r.created_at === 'string' ? r.created_at : '',
      };
    }),
  };
}

export async function submitMeetingPlaceReview(
  payload: MeetingReviewSubmitPayload,
): Promise<{ ok: true; result: MeetingPlaceReviewSubmitResult } | { ok: false; message: string }> {
  const addr = payload.address.trim();
  if (!addr) {
    return { ok: false, message: '장소 정보가 없어 리뷰를 남길 수 없어요.' };
  }
  const { data, error } = await supabase.rpc('upsert_meeting_place_review', {
    p_meeting_id: payload.meetingId.trim(),
    p_app_user_id: payload.appUserId.trim(),
    p_place_id: payload.placeId?.trim() ? payload.placeId.trim() : null,
    p_rating: payload.rating,
    p_selected_keywords: payload.selectedKeywords,
    p_comment: payload.comment?.trim() ? payload.comment.trim() : null,
    p_place_key: payload.placeKey.trim(),
    p_place_name: payload.placeName.trim(),
    p_road_address: addr,
    p_latitude: payload.latitude ?? null,
    p_longitude: payload.longitude ?? null,
    p_category: payload.category?.trim() ? payload.category.trim() : null,
    p_naver_place_link: payload.naverPlaceLink?.trim() ? payload.naverPlaceLink.trim() : null,
    p_preferred_photo_media_url: payload.preferredPhotoMediaUrl?.trim()
      ? payload.preferredPhotoMediaUrl.trim()
      : null,
  });
  if (error) {
    return { ok: false, message: mapReviewApiError(error.message) };
  }
  const o = (data ?? {}) as Record<string, unknown>;
  if (o.ok === false) {
    return { ok: false, message: mapReviewApiError(typeof o.error === 'string' ? o.error : '') };
  }
  return { ok: true, result: parseSubmitResult(data) };
}

export async function fetchMeetingPlaceReviewSummary(
  meetingId: string,
  appUserId: string,
): Promise<{ ok: true; summary: MeetingReviewSummary } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc('get_meeting_place_review_summary', {
    p_meeting_id: meetingId.trim(),
    p_app_user_id: appUserId.trim(),
  });
  if (error) {
    return { ok: false, message: mapReviewApiError(error.message) };
  }
  return { ok: true, summary: parseSummaryRow(data) };
}

export function meetingPlaceReviewSummaryQueryKey(meetingId: string): readonly ['meeting-review', 'summary', string] {
  return ['meeting-review', 'summary', meetingId.trim()] as const;
}
