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
  /** `placeVenue` 결손 시 역·동 이름을 문장에 넣기 */
  areaOnlyHint?: string;
};

const OPENING_GREET_EMPTY =
  '안녕하세요! 반가워요.\n\n어떤 모임을 진행하실 건인지, 몇 분이 언제 어디서 모이실지 한 번에 편하게 말씀해 주세요. 모임 이름이 정해졌다면 함께 적어 주셔도 좋아요.';

/** Edge NLU·분석 실패 시 FAB 말풍선(빈 값 시 `buildMzAgentMessage` 초기 톤으로 돌아가는 것 방지) */
export const MEETING_CREATE_AGENT_NLU_ERROR_RETRY_BUBBLE =
  '잠시만요. 문제가 있어서 전달되지 못했어요. 한 번만 더 말씀해 주시겠어요?';

/**
 * 결손 슬롯 집합에 맞춰 **한두 문장의 고정 한국어**를 고릅니다.
 */
export function pickBundledMeetingCreateNudge(
  missing: MeetingCreateNluMissingSlot[],
  opts: PickBundledMeetingCreateNudgeOpts,
): string {
  // --------------------------------------------------------
  // 1. 방어 코드 및 기본 인사말 처리
  // --------------------------------------------------------
  if (opts.emptyTurn) {
    if (missing.length > 0) {
      return pickBundledMeetingCreateNudge(missing, { ...opts, emptyTurn: false });
    }
    return OPENING_GREET_EMPTY;
  }

  const s = new Set(missing);
  if (s.size === 0) return '';

  const ack = opts.hadPartialAccum ? '알려 주신 내용 반영해 두었어요!\n\n' : '';
  const cat = opts.resolvedCategory ?? null;
  const hasPlace = s.has('place'); // 꼬리말용 장소 누락 여부 캐싱

  // --------------------------------------------------------
  // 2. 하위 상세 정보 (Sub-category Details) 처리
  // (특정 모임 카테고리가 정해졌을 때만 등장하는 슬롯들)
  // --------------------------------------------------------
  if (s.has('moviePick')) {
    return `${ack}함께 보실 영화 제목을 알려 주세요.${hasPlace ? ' 어느 영화관·지역에서 보실지도 함께 알려 주세요.' : ''}`;
  }
  if (s.has('activityKind')) {
    return `${ack}러닝, 등산, 헬스 등 활동 종류를 한 가지 골라 말씀해 주세요.${hasPlace ? ' 모이실 공원·트랙·헬스장 근처도 함께 말씀해 주세요.' : ''}`;
  }
  if (s.has('gameKind')) {
    return `${ack}보드게임, 방탈출, 노래방 등 어떤 놀거리로 모이실 건지 한 가지 골라 주세요.${hasPlace ? ' 모이실 매장·동네도 함께 알려 주세요.' : ''}`;
  }
  if (s.has('pcGameKind')) {
    return `${ack}PC방에서 함께할 게임(예: 발로란트, 리그 오브 레전드)을 한 가지 골라 말씀해 주세요.${hasPlace ? ' 어느 PC방·지역에서 할지도 함께 알려 주세요.' : ''}`;
  }
  if (s.has('focusKnowledge')) {
    return `${ack}독서·스터디, 카공·코워킹 등 모임 성격을 한 가지 골라 말씀해 주세요.${hasPlace ? ' 모이실 스터디 카페·도서관 근처도 함께 알려 주세요.' : ''}`;
  }
  if (s.has('menuPreference')) {
    return `${ack}맛집 모임이시라면, 한식·일식·중식·양식·카페·주점·호프 중 어떤 쪽으로 모이고 싶은지 골라 주세요.`;
  }
  
  // 장소의 세부 위치(Venue) 누락 시
  if (s.has('placeVenue')) {
    const area = opts.areaOnlyHint?.trim();
    return `${ack}${area ? `${area} 주변의 어떤 장소를 찾아드릴까요?` : '어떤 장소를 찾아드릴까요?'}`;
  }

  // --------------------------------------------------------
  // 3. 핵심 정보 (Core: 카테고리, 일정, 인원, 장소) 동적 조합
  // --------------------------------------------------------
  const missingCoreItems: string[] = [];

  if (s.has('category')) missingCoreItems.push('어떤 모임을 진행하실지');
  if (s.has('headcount')) missingCoreItems.push('몇 분이 참석하실지');
  if (s.has('schedule')) missingCoreItems.push('언제 모이실지');

  // 장소(Place)가 누락된 경우의 특수 처리
  if (hasPlace) {
    if (s.has('category')) {
      // 카테고리도 모르는 초기 상태면, 문장을 합치기 위해 배열에 추가
      missingCoreItems.push('어디서 모이실지');
    } else {
      // 카테고리는 이미 아는 상태에서 [일정/인원 + 장소]가 누락된 경우
      if (missingCoreItems.length > 0) {
        return `${ack}${getMeetingCreateNluPlaceNudgeCombined(cat)}`;
      } 
      // 오직 [장소]만 누락된 경우
      return `${ack}${getMeetingCreateNluPlaceNudgePlaceOnly(cat)}`;
    }
  }

  // 누락된 핵심 정보가 있다면 동적으로 이어서 반환
  if (missingCoreItems.length > 0) {
    return `${ack}${missingCoreItems.join(', ')} 알려 주세요.`;
  }

  // --------------------------------------------------------
  // 4. Fallback (모든 조건에 해당하지 않는 기타 누락 시)
  // --------------------------------------------------------
  return `${ack}조금만 더 알려 주시면 모임 만들기를 이어갈게요.`;
}

/** 
 * Edge가 준 이번 턴 패치에 실질 값이 있는지 (안전성 강화) 
 */
export function isMeetingCreateNluPatchSemanticallyEmpty(patch: Record<string, unknown>): boolean {
  if (!patch || Object.keys(patch).length === 0) return true; // null 방어 코드 추가
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