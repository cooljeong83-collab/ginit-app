import type { Category } from '@/src/lib/categories';
import {
    getMeetingCreateNluPlaceNudgeCombined,
    getMeetingCreateNluPlaceNudgePlaceOnly,
} from '@/src/lib/meeting-create-nlu/meeting-create-category-registry';
import type { MeetingCreateNluMissingSlot } from '@/src/lib/meeting-create-nlu/parse-edge-payload';

export type PickBundledMeetingCreateNudgeOpts = {
  /** 인사만·빈 패치·누적 불변 등 “이번 턴에 새 정보 없음” */
  emptyTurn: boolean;
  /** merge 전에 이미 일부 필드가 채워져 있었는지(짧은 인정 문구) */
  hadPartialAccum: boolean;
  /** 누적 JSON에 카테고리가 있으면 장소·세부 재촉 문구를 맞춤 */
  resolvedCategory?: Pick<Category, 'id' | 'label'> | null;
};

const OPENING_GREET_EMPTY =
  '안녕하세요! 반가워요.\n\n어떤 모임을 진행하실 건인지, 몇 분이 언제 어디서 모이실지 한 번에 편하게 말씀해 주세요. 모임 이름이 정해졌다면 함께 적어 주셔도 좋아요.';

/**
 * 결손 슬롯 집합에 맞춰 **한두 문장의 고정 한국어**를 고릅니다(필드명 직설·항목별 따로 묻기 지양).
 */
export function pickBundledMeetingCreateNudge(
  missing: MeetingCreateNluMissingSlot[],
  opts: PickBundledMeetingCreateNudgeOpts,
): string {
  if (opts.emptyTurn) {
    /** 아직 채워야 할 슬롯이 있으면 인사 문구로 덮지 않음 — 이전 턴과 동일 문자열이면 말풍선이 갱신되지 않는 현상 방지 */
    if (missing.length > 0) {
      return pickBundledMeetingCreateNudge(missing, { ...opts, emptyTurn: false });
    }
    return OPENING_GREET_EMPTY;
  }
  const s = new Set(missing);
  if (s.size === 0) {
    return '';
  }

  const ack = opts.hadPartialAccum ? '알려 주신 내용 반영해 두었어요!\n\n' : '';
  const cat = opts.resolvedCategory ?? null;

  if (s.has('moviePick')) {
    const tail = s.has('place') ? ' 어느 영화관·지역에서 보실지도 함께 알려 주세요.' : '';
    return `${ack}함께 보실 영화 제목을 알려 주세요.${tail}`;
  }
  if (s.has('activityKind')) {
    const tail = s.has('place') ? ' 모이실 공원·트랙·헬스장 근처도 함께 말씀해 주세요.' : '';
    return `${ack}러닝, 등산, 헬스 등 활동 종류를 한 가지 골라 말씀해 주세요.${tail}`;
  }
  if (s.has('gameKind')) {
    const tail = s.has('place') ? ' 모이실 매장·동네도 함께 알려 주세요.' : '';
    return `${ack}보드게임, 방탈출, 노래방 등 어떤 놀거리로 모이실 건지 한 가지 골라 주세요.${tail}`;
  }
  if (s.has('pcGameKind')) {
    const tail = s.has('place') ? ' 어느 PC방·지역에서 할지도 함께 알려 주세요.' : '';
    return `${ack}PC방에서 함께할 게임(예: 발로란트, 리그 오브 레전드)을 한 가지 골라 말씀해 주세요.${tail}`;
  }
  if (s.has('focusKnowledge')) {
    const tail = s.has('place') ? ' 모이실 스터디 카페·도서관 근처도 함께 알려 주세요.' : '';
    return `${ack}독서·스터디, 카공·코워킹 등 모임 성격을 한 가지 골라 말씀해 주세요.${tail}`;
  }

  if (s.has('category') && (s.has('schedule') || s.has('headcount') || s.has('place'))) {
    return `${ack}어떤 모임을 진행하실 건인지, 그리고 몇 분이 언제 어디서 모이실지 알려 주세요.`;
  }

  if ((s.has('schedule') || s.has('headcount')) && s.has('place')) {
    return `${ack}${getMeetingCreateNluPlaceNudgeCombined(cat)}`;
  }

  if (s.has('publicMeetingMeta') && s.has('place')) {
    return `${ack}공개 모임으로 이어갈게요. 모집 연령대·성비·정산 방식을 알려 주시고, 어느 쪽에서 모이실지도 함께 말씀해 주세요.`;
  }
  if (s.has('publicMeetingMeta') && (s.has('schedule') || s.has('headcount'))) {
    return `${ack}공개 모임이시군요. 모집 연령대와 성비·회비 정산을 알려 주시고, 몇 분·언제 모이실지도 함께 알려 주세요.`;
  }
  if (s.has('publicMeetingMeta')) {
    return `${ack}공개 모임으로 이어갈게요. 모집할 참가자 연령대(예: 20대만·30대만·제한 없음)와 성비·회비 정산 방식을 한 번에 말씀해 주세요.`;
  }

  if (s.has('schedule') && s.has('headcount')) {
    return `${ack}몇 분이 언제 모이실 건지 알려 주세요.`;
  }

  if (s.has('menuPreference')) {
    return `${ack}맛집 모임이시라면, 한식·일식·중식·양식·카페·주점·호프 중 어떤 쪽으로 모이고 싶은지 골라 주세요.`;
  }

  if (s.has('place')) {
    return `${ack}${getMeetingCreateNluPlaceNudgePlaceOnly(cat)}`;
  }
  if (s.has('schedule')) {
    return `${ack}날짜와 시간을 알려 주세요.`;
  }
  if (s.has('headcount')) {
    return `${ack}몇 분이 모이실 건지 알려 주세요.`;
  }
  if (s.has('category')) {
    return `${ack}어떤 모임을 진행하실 건가요?`;
  }

  return `${ack}조금만 더 알려 주시면 모임 만들기를 이어갈게요.`;
}

/** Edge가 준 이번 턴 패치에 실질 값이 있는지(전부 null/빈 문자열이면 true = “비어 있음”) */
export function isMeetingCreateNluPatchSemanticallyEmpty(patch: Record<string, unknown>): boolean {
  if (Object.keys(patch).length === 0) return true;
  for (const v of Object.values(patch)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim().length > 0) return false;
    if (typeof v === 'boolean') return false;
    if (typeof v === 'number' && Number.isFinite(v)) return false;
    if (Array.isArray(v) && v.length > 0) return false;
    if (typeof v === 'object' && !Array.isArray(v)) {
      if (!isMeetingCreateNluPatchSemanticallyEmpty(v as Record<string, unknown>)) return false;
    }
  }
  return true;
}
