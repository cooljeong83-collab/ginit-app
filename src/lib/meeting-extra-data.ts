import type { SpecialtyKind } from '@/src/lib/category-specialty';

export type SelectedMovieExtra = {
  id: string;
  title: string;
  year?: string;
  info?: string;
  /**
   * 영화 API(KOBIS/TMDB 등)에서 확보한 원본 메타.
   * - Firestore에 그대로 저장되어, 모임 상세에서 "가진 정보 전부"를 펼쳐 보여줄 때 사용합니다.
   */
  apiMeta?: Record<string, string>;
  /** 포스터(표시용, TMDB 등 HTTPS URL) */
  posterUrl?: string;
  /** 평점·관객수 등 짧은 뱃지 텍스트 */
  rating?: string;
  /** KOBIS 일별 박스오피스 `rank` (1~10 등) */
  kobisRank?: string;
};

/**
 * 모임 등록 시 Firestore에 함께 저장하는 카테고리 특화 필드.
 */
export type MeetingExtraData = {
  specialtyKind: SpecialtyKind;
  /** 첫 번째 후보(이전 단일 선택 필드와의 호환) */
  movie?: SelectedMovieExtra | null;
  /** 영화 모임 후보 전체 */
  movies?: SelectedMovieExtra[] | null;
  menuPreferences?: string[] | null;
  /** Active & Life 등 — 메뉴 성향과 동일하게 복수 칩으로 저장 */
  activityKinds?: string[] | null;
  /** Play & Vibe — 선호 게임 종류 칩 */
  gameKinds?: string[] | null;
  /** Focus & Knowledge — 모임 성향 칩 */
  focusKnowledgePreferences?: string[] | null;
  /** 모임 생성 시점 `meeting_categories.major_code` — 상세·장소 제안에서 PcGame 등 구분 */
  categoryMajorCode?: string | null;
};

/** Firestore에 undefined가 들어가지 않도록 영화 후보만 정제 */
function sanitizeMovieForFirestore(m: SelectedMovieExtra): SelectedMovieExtra {
  const id = String(m.id ?? '').trim() || 'movie';
  const title = String(m.title ?? '').trim() || '제목 미정';
  const out: SelectedMovieExtra = { id, title };
  if (m.year != null && String(m.year).trim() !== '') out.year = String(m.year).trim();
  if (m.info != null && String(m.info).trim() !== '') out.info = String(m.info).trim();
  if (m.apiMeta && typeof m.apiMeta === 'object' && !Array.isArray(m.apiMeta)) {
    const entries = Object.entries(m.apiMeta)
      .map(([k, v]) => [String(k).trim(), String(v ?? '').trim()] as const)
      .filter(([k, v]) => Boolean(k) && Boolean(v));
    if (entries.length > 0) out.apiMeta = Object.fromEntries(entries);
  }
  if (m.posterUrl != null && String(m.posterUrl).trim() !== '') out.posterUrl = String(m.posterUrl).trim();
  if (m.rating != null && String(m.rating).trim() !== '') out.rating = String(m.rating).trim();
  if (m.kobisRank != null && String(m.kobisRank).trim() !== '') out.kobisRank = String(m.kobisRank).trim();
  return out;
}

export function buildMeetingExtraData(params: {
  kind: SpecialtyKind;
  /** 영화 카테고리일 때 후보 목록(순서 유지) */
  movies?: SelectedMovieExtra[];
  menuPreferences: string[];
  /** `specialtyKind === 'sports'`이고 Active & Life 등에서 선택한 활동 종류 */
  activityKinds?: string[];
  /** `specialtyKind === 'sports'`이고 Play & Vibe에서 선택한 게임 종류 */
  gameKinds?: string[];
  /** `specialtyKind === 'knowledge'`일 때 모임 성격 칩 */
  focusKnowledgePreferences?: string[];
  categoryMajorCode?: string | null;
}): MeetingExtraData {
  const {
    kind,
    movies,
    menuPreferences,
    activityKinds,
    gameKinds,
    focusKnowledgePreferences,
    categoryMajorCode,
  } = params;
  const majorSnap = String(categoryMajorCode ?? '').trim();
  const majorField: Pick<MeetingExtraData, 'categoryMajorCode'> | Record<string, never> =
    majorSnap.length > 0 ? { categoryMajorCode: majorSnap } : {};
  if (kind === 'movie') {
    const raw = movies?.filter((x) => x != null && String(x.id ?? '').trim() !== '') ?? [];
    const list = raw.map(sanitizeMovieForFirestore);
    const first = list[0] ?? null;
    return {
      specialtyKind: 'movie',
      movie: first,
      movies: list.length > 0 ? list : null,
      ...majorField,
    };
  }
  if (kind === 'food') {
    return {
      specialtyKind: 'food',
      menuPreferences: menuPreferences.length ? [...menuPreferences] : null,
      ...majorField,
    };
  }
  if (kind === 'knowledge') {
    const fk = (focusKnowledgePreferences ?? []).map((x) => String(x ?? '').trim()).filter(Boolean);
    return {
      specialtyKind: 'knowledge',
      focusKnowledgePreferences: fk.length ? [...fk] : null,
      ...majorField,
    };
  }
  const out: MeetingExtraData = {
    specialtyKind: 'sports',
    ...majorField,
  };
  const acts = (activityKinds ?? []).map((x) => String(x ?? '').trim()).filter(Boolean);
  if (acts.length > 0) out.activityKinds = acts;
  const gk = (gameKinds ?? []).map((x) => String(x ?? '').trim()).filter(Boolean);
  if (gk.length > 0) out.gameKinds = gk;
  return out;
}
