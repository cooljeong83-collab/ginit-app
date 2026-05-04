import type { Category } from '@/src/lib/categories';
import {
  categoryNeedsSpecialty,
  isActiveLifeMajorCode,
  isPcGameMajorCode,
  isPlayAndVibeMajorCode,
  resolveSpecialtyKindForCategory,
} from '@/src/lib/category-specialty';
import { parseSmartNaturalSchedule } from '@/src/lib/natural-language-schedule';
import type { PublicMeetingDetailsConfig } from '@/src/lib/meetings';

import type {
  MeetingCreateNluEdgePayload,
  MeetingCreateNluInference,
  MeetingCreateNluPlan,
} from '@/src/lib/meeting-create-nlu/types';
import { mergePublicMeetingDetailsFromNluRecord } from '@/src/lib/meeting-create-nlu/merge-public-meeting-details';
import type { PublicMeetingAgeLimit } from '@/src/lib/meetings';
import {
  coerceWizardFocusKnowledgeLabel,
  coerceWizardGameKindLabel,
  coerceWizardMenuPreferenceLabel,
  coerceWizardPcGameKindLabel,
  resolveWizardActivityKindLabel,
} from '@/src/lib/meeting-create-nlu/wizard-specialty-chip-options';
import { isAreaOnlyPlaceQuery } from '@/src/lib/meeting-create-nlu/local-intent-patch';

function isPublicMeetingAgeLimitToken(x: unknown): x is PublicMeetingAgeLimit {
  return x === 'TWENTIES' || x === 'THIRTIES' || x === 'FORTY_PLUS' || x === 'NONE';
}

/**
 * `minParticipants`/`maxParticipants` 또는 한글 `인원.{최소,최대}`(누적 JSON)에서 인원 쌍을 읽습니다.
 */
export function resolveMeetingCreateHeadcountFromPayload(p: MeetingCreateNluEdgePayload): {
  min: number;
  max: number;
} | null {
  let minP = typeof p.minParticipants === 'number' && Number.isFinite(p.minParticipants) ? Math.trunc(p.minParticipants) : NaN;
  let maxP = typeof p.maxParticipants === 'number' && Number.isFinite(p.maxParticipants) ? Math.trunc(p.maxParticipants) : NaN;
  const crew = (p as Record<string, unknown>)['인원'];
  if (crew && typeof crew === 'object' && !Array.isArray(crew)) {
    const c = crew as Record<string, unknown>;
    if (!Number.isFinite(minP) && typeof c['최소'] === 'number' && Number.isFinite(c['최소'])) {
      minP = Math.trunc(c['최소'] as number);
    }
    if (!Number.isFinite(maxP) && typeof c['최대'] === 'number' && Number.isFinite(c['최대'])) {
      maxP = Math.trunc(c['최대'] as number);
    }
  }
  if (!Number.isFinite(minP) || minP < 1 || !Number.isFinite(maxP) || maxP < minP) return null;
  return { min: minP, max: maxP };
}

function activityKindHaystackFromPayload(p: MeetingCreateNluEdgePayload): string {
  return [
    typeof p.title === 'string' ? p.title : '',
    typeof p.placeAutoPickQuery === 'string' ? p.placeAutoPickQuery : '',
    typeof p.scheduleText === 'string' ? p.scheduleText : '',
  ]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');
}

function publicMeetingDetailsHasAgeLimit(p: MeetingCreateNluEdgePayload): boolean {
  const d = p.publicMeetingDetails;
  if (d == null || typeof d !== 'object' || Array.isArray(d)) return false;
  const al = (d as Record<string, unknown>).ageLimit;
  if (!Array.isArray(al)) return false;
  return al.some(isPublicMeetingAgeLimitToken);
}

function normalizedMovieTitleHints(p: MeetingCreateNluEdgePayload): string[] {
  const out: string[] = [];
  const pt = typeof p.primaryMovieTitle === 'string' ? p.primaryMovieTitle.normalize('NFKC').trim() : '';
  if (pt) out.push(pt);
  const raw = (p as Record<string, unknown>)['영화제목'];
  if (typeof raw === 'string' && raw.trim()) {
    const t = raw.normalize('NFKC').trim();
    if (t && !out.includes(t)) out.push(t);
  }
  const h = p.movieTitleHints;
  if (Array.isArray(h)) {
    for (const x of h) {
      const t = String(x ?? '').normalize('NFKC').trim();
      if (t.length > 0 && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

export function meetingCreateMovieHintsSatisfied(p: MeetingCreateNluEdgePayload): boolean {
  return normalizedMovieTitleHints(p).length > 0;
}

function step3SpecialtySatisfied(
  catObj: Category | null,
  p: MeetingCreateNluEdgePayload,
  menuCoerced: string | null,
  movieHints: string[],
  activityCoerced: ReturnType<typeof coerceWizardActivityKindLabel>,
  gameCoerced: ReturnType<typeof coerceWizardGameKindLabel>,
  pcCoerced: ReturnType<typeof coerceWizardPcGameKindLabel>,
  focusCoerced: ReturnType<typeof coerceWizardFocusKnowledgeLabel>,
): boolean {
  if (!catObj || !categoryNeedsSpecialty(catObj)) return true;
  const sk = resolveSpecialtyKindForCategory(catObj);
  if (sk === 'food') return Boolean(menuCoerced);
  if (sk === 'movie') return movieHints.length > 0;
  if (sk === 'sports') {
    if (isActiveLifeMajorCode(catObj.majorCode)) return activityCoerced != null;
    if (isPlayAndVibeMajorCode(catObj.majorCode)) return gameCoerced != null;
    if (isPcGameMajorCode(catObj.majorCode)) return pcCoerced != null;
    return true;
  }
  if (sk === 'knowledge') return focusCoerced != null;
  return true;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const HM_RE = /^\d{2}:\d{2}$/;

function clampHm(h: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(h.trim());
  if (!m) return '19:00';
  const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function pickNluInference(raw: unknown): MeetingCreateNluInference | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const intent = typeof o.intent_strength === 'string' && o.intent_strength.trim() ? o.intent_strength.trim() : null;
  const social = typeof o.social_context === 'string' && o.social_context.trim() ? o.social_context.trim() : null;
  const reasoning = typeof o.reasoning === 'string' && o.reasoning.trim() ? o.reasoning.trim() : null;
  if (!intent && !social && !reasoning) return null;
  return { intent_strength: intent, social_context: social, reasoning };
}

/** Edge 누적/부분 payload에서 카테고리 id 화이트리스트 매핑 */
export function resolveMeetingCreateCategoryId(
  categories: Category[],
  payload: MeetingCreateNluEdgePayload,
): string | null {
  const id = String(payload.categoryId ?? '').trim();
  if (id && categories.some((c) => c.id.trim() === id)) return id;

  const majorHint = String((payload as Record<string, unknown>).majorCodeHint ?? '').trim();
  if (majorHint) {
    const h = majorHint.toLowerCase();
    const byMajor = categories.find((c) => (c.majorCode ?? '').trim().toLowerCase() === h);
    if (byMajor) return byMajor.id.trim();
    const byLabelEq = categories.find((c) => c.label.trim().toLowerCase() === h);
    if (byLabelEq) return byLabelEq.id.trim();
  }

  const label = String(payload.categoryLabel ?? '').trim();
  if (!label) return null;
  const exact = categories.find((c) => c.label.trim() === label);
  if (exact) return exact.id;
  return categories.find((c) => c.label.includes(label) || label.includes(c.label.trim()))?.id ?? null;
}

export function meetingCreateScheduleFromEdgePayload(
  payload: MeetingCreateNluEdgePayload,
  now: Date,
): { ymd: string; hm: string } | null {
  const ymd = String(payload.scheduleYmd ?? '').trim();
  const hm = clampHm(String(payload.scheduleHm ?? '19:00'));
  if (YMD_RE.test(ymd) && HM_RE.test(hm)) return { ymd, hm };
  const text = String(payload.scheduleText ?? '').trim();
  if (!text) return null;
  const parsed = parseSmartNaturalSchedule(text, now);
  if (!parsed) return null;
  const c = parsed.candidate;
  const sd = String(c?.startDate ?? '').trim();
  const st = String(c?.startTime ?? '').trim();
  if (!YMD_RE.test(sd)) return null;
  return { ymd: sd, hm: st && HM_RE.test(clampHm(st)) ? clampHm(st) : '19:00' };
}

/**
 * Edge 응답 JSON을 카테고리 화이트리스트·일정 파싱 규칙으로 검증합니다.
 * 실패 시 `ok: false` — 메시지는 FAB/토스트에 사용.
 */
export function parseMeetingCreateNluPayload(
  categories: Category[],
  raw: unknown,
  now: Date = new Date(),
): { ok: true; plan: MeetingCreateNluPlan } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '응답 형식이 올바르지 않습니다.' };
  }
  const p = raw as MeetingCreateNluEdgePayload;
  const categoryId = resolveMeetingCreateCategoryId(categories, p);
  if (!categoryId) {
    return { ok: false, error: '모임 성격(카테고리)을 알 수 없어요. 목록에서 골라 주세요.' };
  }
  const cat = categories.find((c) => c.id.trim() === categoryId);
  const categoryLabel = (cat?.label?.trim() ?? String(p.categoryLabel ?? '').trim()) || '모임';

  const sched = meetingCreateScheduleFromEdgePayload(p, now);
  if (!sched) {
    return { ok: false, error: '일정(날짜·시간)을 해석하지 못했어요. 일정을 입력해 주세요.' };
  }

  const title = String(p.title ?? '').trim();
  if (!title) {
    return { ok: false, error: '모임 제목을 정하지 못했어요.' };
  }

  const hc = resolveMeetingCreateHeadcountFromPayload(p);
  if (!hc) {
    return { ok: false, error: '최소·최대 인원을 알 수 없어요.' };
  }
  const minP = hc.min;
  const maxP = hc.max;

  const placeAutoPickQuery = String(p.placeAutoPickQuery ?? '').trim() || null;
  const menuPreferenceLabel = coerceWizardMenuPreferenceLabel(
    typeof p.menuPreferenceLabel === 'string' ? p.menuPreferenceLabel : null,
  );

  const movieTitleHints = normalizedMovieTitleHints(p);
  const activityKindLabel = resolveWizardActivityKindLabel(p.activityKindLabel, activityKindHaystackFromPayload(p));
  const gameKindLabel = coerceWizardGameKindLabel(p.gameKindLabel);
  const pcGameKindLabel = coerceWizardPcGameKindLabel(p.pcGameKindLabel);
  const focusKnowledgeLabel = coerceWizardFocusKnowledgeLabel(p.focusKnowledgeLabel);

  const unknowns = Array.isArray(p.unknowns) ? p.unknowns : [];
  const unknownFields = unknowns
    .map((u) => String(u?.field ?? '').trim())
    .filter(Boolean);

  const nluAskMessage = typeof p.nluAskMessage === 'string' && p.nluAskMessage.trim() ? p.nluAskMessage.trim() : null;
  const nluConfirmMessage =
    typeof p.nluConfirmMessage === 'string' && p.nluConfirmMessage.trim() ? p.nluConfirmMessage.trim() : null;
  const nluInference = pickNluInference(p.nluInference);

  const pubMerge = mergePublicMeetingDetailsFromNluRecord(
    p.publicMeetingDetails != null && typeof p.publicMeetingDetails === 'object' && !Array.isArray(p.publicMeetingDetails)
      ? (p.publicMeetingDetails as Record<string, unknown>)
      : null,
  );

  const suggestedIsPublic = typeof p.suggestedIsPublic === 'boolean' ? p.suggestedIsPublic : null;

  const catObj = categories.find((c) => c.id.trim() === categoryId.trim()) ?? null;
  const needs = categoryNeedsSpecialty(catObj);
  const canAutoCompleteThroughStep3 = step3SpecialtySatisfied(
    catObj,
    p,
    menuPreferenceLabel,
    movieTitleHints,
    activityKindLabel,
    gameKindLabel,
    pcGameKindLabel,
    focusKnowledgeLabel,
  );

  return {
    ok: true,
    plan: {
      categoryId,
      categoryLabel,
      suggestedIsPublic,
      title,
      minParticipants: minP,
      maxParticipants: maxP,
      autoSchedule: sched,
      placeAutoPickQuery,
      menuPreferenceLabel,
      movieTitleHints,
      activityKindLabel,
      gameKindLabel,
      pcGameKindLabel,
      focusKnowledgeLabel,
      canAutoCompleteThroughStep3,
      publicMeetingDetailsPartial: pubMerge.ok ? pubMerge.value : null,
      unknownFields,
      nluAskMessage: nluAskMessage ?? undefined,
      nluConfirmMessage: nluConfirmMessage ?? undefined,
      nluInference: nluInference ?? undefined,
    },
  };
}

/** `parseMeetingCreateNluPayload`와 동일한 최소 필드 집합 기준의 결손 슬롯(멀티턴 고정 질문용) */
export type MeetingCreateNluMissingSlot =
  | 'category'
  | 'menuPreference'
  | 'moviePick'
  | 'activityKind'
  | 'gameKind'
  | 'pcGameKind'
  | 'focusKnowledge'
  | 'schedule'
  | 'headcount'
  | 'place'
  /** 역·동·구 등 지역만 있고 업종·시설 구체화가 필요할 때 */
  | 'placeVenue'
  | 'publicMeetingMeta';

/**
 * 누적 JSON이 아직 완전한 계획이 아닐 때, 무엇이 비었는지 순서대로 나열합니다.
 * `parseMeetingCreateNluPayload`와 동일 규칙(장소는 비공백 검색어·분위기 문구면 충족).
 */
export function peekMeetingCreateNluMissingSlots(
  categories: Category[],
  raw: unknown,
  now: Date = new Date(),
): MeetingCreateNluMissingSlot[] {
  const missing: MeetingCreateNluMissingSlot[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return ['category', 'schedule', 'headcount', 'place'];
  }
  const p = raw as MeetingCreateNluEdgePayload;

  const categoryId = resolveMeetingCreateCategoryId(categories, p);
  if (!categoryId) {
    missing.push('category');
  } else {
    const catObj = categories.find((c) => c.id.trim() === categoryId.trim()) ?? null;
    const sk = resolveSpecialtyKindForCategory(catObj);
    const needs = categoryNeedsSpecialty(catObj);
    if (sk === 'food' && needs) {
      const menu = coerceWizardMenuPreferenceLabel(
        typeof p.menuPreferenceLabel === 'string' ? p.menuPreferenceLabel : null,
      );
      if (!menu) missing.push('menuPreference');
    }
    if (sk === 'movie' && needs && !meetingCreateMovieHintsSatisfied(p)) {
      missing.push('moviePick');
    }
    if (sk === 'sports' && needs && isActiveLifeMajorCode(catObj?.majorCode)) {
      if (!resolveWizardActivityKindLabel(p.activityKindLabel, activityKindHaystackFromPayload(p))) {
        missing.push('activityKind');
      }
    }
    if (sk === 'sports' && needs && isPlayAndVibeMajorCode(catObj?.majorCode)) {
      if (!coerceWizardGameKindLabel(p.gameKindLabel)) missing.push('gameKind');
    }
    if (sk === 'sports' && needs && isPcGameMajorCode(catObj?.majorCode)) {
      if (!coerceWizardPcGameKindLabel(p.pcGameKindLabel)) missing.push('pcGameKind');
    }
    if (sk === 'knowledge' && needs) {
      if (!coerceWizardFocusKnowledgeLabel(p.focusKnowledgeLabel)) missing.push('focusKnowledge');
    }
  }

  const sched = meetingCreateScheduleFromEdgePayload(p, now);
  if (!sched) missing.push('schedule');

  const hc = resolveMeetingCreateHeadcountFromPayload(p);
  if (!hc) {
    missing.push('headcount');
  }

  if (categoryId && p.suggestedIsPublic === true && !publicMeetingDetailsHasAgeLimit(p)) {
    missing.push('publicMeetingMeta');
  }

  const placeQ =
    String(p.placeAutoPickQuery ?? '').trim() ||
    (typeof (p as Record<string, unknown>)['장소'] === 'string'
      ? String((p as Record<string, unknown>)['장소']).trim()
      : '');
  if (!placeQ) missing.push('place');
  else if (isAreaOnlyPlaceQuery(placeQ)) missing.push('placeVenue');

  return missing;
}
