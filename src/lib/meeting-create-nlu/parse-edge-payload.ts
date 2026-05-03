import type { Category } from '@/src/lib/categories';
import { categoryNeedsSpecialty, resolveSpecialtyKindForCategory } from '@/src/lib/category-specialty';
import { parseSmartNaturalSchedule } from '@/src/lib/natural-language-schedule';
import type { PublicMeetingDetailsConfig } from '@/src/lib/meetings';

import type { MeetingCreateNluEdgePayload, MeetingCreateNluPlan } from '@/src/lib/meeting-create-nlu/types';
import { mergePublicMeetingDetailsFromNluRecord } from '@/src/lib/meeting-create-nlu/merge-public-meeting-details';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const HM_RE = /^\d{2}:\d{2}$/;

function clampHm(h: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(h.trim());
  if (!m) return '19:00';
  const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function resolveCategoryId(categories: Category[], payload: MeetingCreateNluEdgePayload): string | null {
  const id = String(payload.categoryId ?? '').trim();
  if (id && categories.some((c) => c.id.trim() === id)) return id;
  const label = String(payload.categoryLabel ?? '').trim();
  if (!label) return null;
  const exact = categories.find((c) => c.label.trim() === label);
  if (exact) return exact.id;
  return categories.find((c) => c.label.includes(label) || label.includes(c.label.trim()))?.id ?? null;
}

function scheduleFromPayload(payload: MeetingCreateNluEdgePayload, now: Date): { ymd: string; hm: string } | null {
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
  const categoryId = resolveCategoryId(categories, p);
  if (!categoryId) {
    return { ok: false, error: '모임 성격(카테고리)을 알 수 없어요. 목록에서 골라 주세요.' };
  }
  const cat = categories.find((c) => c.id.trim() === categoryId);
  const categoryLabel = (cat?.label?.trim() ?? String(p.categoryLabel ?? '').trim()) || '모임';

  const sched = scheduleFromPayload(p, now);
  if (!sched) {
    return { ok: false, error: '일정(날짜·시간)을 해석하지 못했어요. 일정을 입력해 주세요.' };
  }

  const title = String(p.title ?? '').trim();
  if (!title) {
    return { ok: false, error: '모임 제목을 정하지 못했어요.' };
  }

  const minP = typeof p.minParticipants === 'number' && Number.isFinite(p.minParticipants) ? Math.trunc(p.minParticipants) : NaN;
  const maxP = typeof p.maxParticipants === 'number' && Number.isFinite(p.maxParticipants) ? Math.trunc(p.maxParticipants) : NaN;
  if (!Number.isFinite(minP) || minP < 1) {
    return { ok: false, error: '최소 인원을 알 수 없어요.' };
  }
  if (!Number.isFinite(maxP) || maxP < minP) {
    return { ok: false, error: '최대 인원을 알 수 없어요.' };
  }

  const placeAutoPickQuery = String(p.placeAutoPickQuery ?? '').trim() || null;
  const menuPreferenceLabel =
    typeof p.menuPreferenceLabel === 'string' && p.menuPreferenceLabel.trim() ? p.menuPreferenceLabel.trim() : null;

  const unknowns = Array.isArray(p.unknowns) ? p.unknowns : [];
  const unknownFields = unknowns
    .map((u) => String(u?.field ?? '').trim())
    .filter(Boolean);

  const pubMerge = mergePublicMeetingDetailsFromNluRecord(
    p.publicMeetingDetails != null && typeof p.publicMeetingDetails === 'object' && !Array.isArray(p.publicMeetingDetails)
      ? (p.publicMeetingDetails as Record<string, unknown>)
      : null,
  );

  const suggestedIsPublic = typeof p.suggestedIsPublic === 'boolean' ? p.suggestedIsPublic : null;

  const catObj = categories.find((c) => c.id.trim() === categoryId.trim()) ?? null;
  const sk = resolveSpecialtyKindForCategory(catObj);
  const needs = categoryNeedsSpecialty(catObj);
  const food = sk === 'food';
  const canAutoCompleteThroughStep3 = !needs || (food && Boolean(menuPreferenceLabel));

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
      canAutoCompleteThroughStep3,
      publicMeetingDetailsPartial: pubMerge.ok ? pubMerge.value : null,
      unknownFields,
    },
  };
}
