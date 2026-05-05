import type { LayoutChangeEvent } from 'react-native';
import type { ReactNode, RefObject } from 'react';

import type { SpecialtyKind } from '@/src/lib/category-specialty';
import type { VoteCandidatesPayload } from '@/src/lib/meeting-place-bridge';

export type MeetingCreatePlacesAutoAssistSnapshot = {
  searchLoading: boolean;
  searchError: string | null;
  resultCount: number;
  hasFilledPlace: boolean;
  queryTrim: string;
  /** 좌표 보강(`resolvePlaceSearchRowCoordinates`) 진행 중인 행이 하나라도 있으면 true */
  anyPlaceResolving: boolean;
  /** 마지막으로 인라인 Google 검색이 끝난 쿼리(로딩 종료 시점); 진행 중이거나 미검색이면 null */
  lastSettledQueryTrim: string | null;
};

export type VoteCandidatesFormProps = {
  seedPlaceQuery?: string;
  seedScheduleDate: string;
  seedScheduleTime: string;
  /** 장소 후보 단계: AI 검색어 생성에 쓰는 테마(카테고리 라벨) */
  placeThemeLabel?: string;
  /** `major_code` 기반 특화 — 장소 시드가 라벨 정규식과 어긋나지 않게 전달 */
  placeThemeSpecialtyKind?: SpecialtyKind | null;
  /** `major_code` Eat & Drink 등 — Step2 메뉴 성향이 장소 추천어에 반영되도록 전달 */
  placeMenuPreferenceLabels?: readonly string[] | null;
  /** 장소 시드·추천어에서 Eat & Drink 전용(카테고리명·시각·인원·브런치 제외 규칙) 분기 */
  placeThemeMajorCode?: string | null;
  /** Active & Life — Step2 활동 종류를 장소 추천어·시드 풀에 반영 */
  placeActivityKindLabels?: readonly string[] | null;
  /** Play & Vibe — Step2 게임 종류를 장소 시드에 반영 */
  placeGameKindLabels?: readonly string[] | null;
  /** Focus & Knowledge — Step2 모임 성격 칩을 장소 시드에 반영 */
  placeFocusKnowledgePreferenceLabels?: readonly string[] | null;
  /** 비공개 모임 인원 — 장소 검색어 보강(소수/다인원). 공개 모임에서는 생략 */
  placeMinParticipants?: number;
  placeMaxParticipants?: number;
  initialPayload?: VoteCandidatesPayload | null;
  embedded?: boolean;
  /** true면 부모 ScrollView 안에만 렌더(내부 스크롤·scrollTo 없음) */
  bare?: boolean;
  /** 마법사 단계별로 일정/장소 블록만 표시 (`none` = UI 없이 상태만 유지) */
  wizardSegment?: 'both' | 'schedule' | 'places' | 'none';
  /** 장소 블록 레이아웃(스크롤 앵커 등) — `layout.y`는 일정·장소 공통 래퍼 기준 */
  onPlacesBlockLayout?: (e: LayoutChangeEvent) => void;
  /** `wizardSegment`가 `places`일 때 장소 섹션 맨 위에 삽입(예: 단계 배지) */
  headerBeforePlaces?: ReactNode;
  /** true면 일정 카드 목록만 표시(자연어 입력·일정 후보 추가 버튼 숨김) — 상세 단계에서 확정 목록 유지용 */
  scheduleListOnly?: boolean;
  /** true면 장소 후보 카드는 유지하고 추가·삭제(행 2개 이상일 때)만 숨김 — 상세 단계에서 확정 장소 유지용 */
  placesListOnly?: boolean;
  /** `bare`일 때 상위 세로 스크롤 — 일정 후보 추가 시 새 카드가 보이도록 오프셋 보정 */
  parentScrollRef?: RefObject<any>;
  /** 상위 `ScrollView`의 `contentOffset.y` (onScroll로 갱신) */
  parentScrollYRef?: RefObject<number>;
  /** true면 AI 미리보기/주말 미리보기 탭 시 새 행이 아니라 첫 번째 일정 후보만 덮어씀(날짜 제안 모달 등). `+ 일자 후보 등록` 버튼도 숨김 */
  scheduleAiReplacesFirstCandidate?: boolean;
  /**
   * 설정 시 장소「카카오 / 네이버」상세 링크는 내부 WebView 모달 대신 상위에서 연다(모임 상세 장소 제안 등 **Modal 중첩** 방지).
   */
  onNaverPlaceWebOpen?: (url: string, title: string) => void;
  /** AI 자동 등록으로 장소 검색어가 주입된 뒤 — 검색·선택 상태(확인 버튼·3초 타임아웃) */
  onPlacesAutoAssistSnapshot?: (s: MeetingCreatePlacesAutoAssistSnapshot) => void;
};

export type VoteCandidatesBuildResult =
  | { ok: true; payload: VoteCandidatesPayload }
  | { ok: false; error: string };

export type VoteCandidatesGateResult = { ok: true } | { ok: false; error: string };

export type VoteCandidatesFormHandle = {
  buildPayload: () => VoteCandidatesBuildResult;
  validateScheduleStep: () => Promise<VoteCandidatesGateResult>;
  validatePlacesStep: () => VoteCandidatesGateResult;
  /** 일정 스텝 첫 입력(자연어) 포커스 */
  focusScheduleIdeaInput: () => void;
  /** 장소 스텝 첫 입력(검색어) 포커스 */
  focusPlaceQueryInput: () => void;
  /** 첫 장소 행에 검색어를 넣고 장소 검색 화면을 열어 자동 검색·포커스 */
  openFirstPlaceSearchWithSuggestedQuery: (suggestedQuery: string, opts?: { createAutopilot?: boolean }) => void;
  /** 인라인 장소 검색어 주입 후 debounce 검색(에이전트) */
  setPlaceQueryFromAgent: (q: string) => void;
  /** 장소 검색 대기 행·모달 등 파생 UI 정리 */
  resetPlaceSearchSession: () => void;
  /** 장소 후보가 비어 있으면 등록 가능한 플레이스홀더 1행 삽입(일정 확정 후 장소 단계 생략 시) */
  ensurePlacesForWizardFinalize: () => void;
  /** 일정 확정 시점의 일시·장소를 부모 상태와 동기화하기 위해 스냅샷(장소 없으면 플레이스홀더 포함) */
  captureWizardPayloadAfterSchedule: () => VoteCandidatesBuildResult;
  /** 모임 상세「장소 제안」등 — 채워진 장소 행만 검증·스냅샷 (`dateCandidates`는 빈 배열) */
  capturePlaceCandidatesOnly: () => VoteCandidatesBuildResult;
  /** 스냅샷을 폼 내부 상태에 반영 — 리마운트 없이 buildPayload와 일치시킴 */
  applyCapturedPayload: (p: VoteCandidatesPayload) => void;
  /**
   * FAB 자동 적용: 달력 월 맞춤 → 날짜 셀 강조 →(iOS·웹) 시간 피커 스피너 값을 단계적으로 갱신한 뒤 후보 확정.
   * Android는 네이티브 시간 피커를 프로그램으로 돌릴 수 없어 동일 후보를 강조 후 바로 반영합니다.
   */
  playAgentSchedulePickAnimation: (opts: {
    ymd: string;
    hm: string;
    isAlive: () => boolean;
  }) => Promise<void>;
  /** 자동 모임 생성: 검색 완료 후 상위 1~N개 후보를 좌표 확정까지 담는다 */
  playAgentPlaceInlinePick: (opts: {
    maxPicks: number;
    isAlive: () => boolean;
  }) => Promise<'ok' | 'empty' | 'error' | 'aborted'>;
};
