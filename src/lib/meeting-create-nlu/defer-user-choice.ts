import type { MeetingCreateNluMissingSlot } from '@/src/lib/meeting-create-nlu/parse-edge-payload';
import {
  WIZARD_ACTIVITY_KIND_LABELS,
  WIZARD_FOCUS_KNOWLEDGE_LABELS,
  WIZARD_GAME_KIND_LABELS,
  WIZARD_MENU_PREFERENCE_LABELS,
  WIZARD_PC_GAME_KIND_LABELS,
  type WizardActivityKindLabel,
  type WizardFocusKnowledgeLabel,
  type WizardGameKindLabel,
  type WizardMenuPreferenceLabel,
  type WizardPcGameKindLabel,
} from '@/src/lib/meeting-create-nlu/wizard-specialty-chip-options';

/** 사용자가 세부 선택을 앱/추천에 맡길 때 흔한 한국어 표현 */
const DEFER_CHOICE_RE =
  /(?:아무거나|알아서|상관\s*없(?:어|음|다)?|랜덤|무작위|다\s*좋아|다\s*괜찮아|추천\s*해\s*줘|추천해줘|너가\s*골라\s*줘|너가\s*골라줘|님이\s*골라\s*줘|님이\s*골라줘|너가\s*정해\s*줘|너가\s*정해줘|편한\s*대로|아무\s*거나)/u;

function normUtterance(raw: string): string {
  return raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function isDeferUserChoiceUtterance(text: string): boolean {
  const t = normUtterance(text);
  if (t.length === 0) return false;
  return DEFER_CHOICE_RE.test(t);
}

function djb2LikeHash(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 33) ^ seed.charCodeAt(i)!;
  }
  return h >>> 0;
}

function pickIndexDeterministic(listLen: number, seed: string): number {
  if (listLen <= 0) return 0;
  return djb2LikeHash(seed) % listLen;
}

export function pickDeterministicMenuPreferenceForDefer(seed: string): WizardMenuPreferenceLabel {
  const i = pickIndexDeterministic(WIZARD_MENU_PREFERENCE_LABELS.length, `menu:${seed}`);
  return WIZARD_MENU_PREFERENCE_LABELS[i]!;
}

export function pickDeterministicActivityKindForDefer(seed: string): WizardActivityKindLabel {
  const i = pickIndexDeterministic(WIZARD_ACTIVITY_KIND_LABELS.length, `act:${seed}`);
  return WIZARD_ACTIVITY_KIND_LABELS[i]!;
}

export function pickDeterministicGameKindForDefer(seed: string): WizardGameKindLabel {
  const i = pickIndexDeterministic(WIZARD_GAME_KIND_LABELS.length, `game:${seed}`);
  return WIZARD_GAME_KIND_LABELS[i]!;
}

export function pickDeterministicPcGameKindForDefer(seed: string): WizardPcGameKindLabel {
  const i = pickIndexDeterministic(WIZARD_PC_GAME_KIND_LABELS.length, `pc:${seed}`);
  return WIZARD_PC_GAME_KIND_LABELS[i]!;
}

export function pickDeterministicFocusKnowledgeForDefer(seed: string): WizardFocusKnowledgeLabel {
  const i = pickIndexDeterministic(WIZARD_FOCUS_KNOWLEDGE_LABELS.length, `fk:${seed}`);
  return WIZARD_FOCUS_KNOWLEDGE_LABELS[i]!;
}

/**
 * 위임 발화일 때 `peekMeetingCreateNluMissingSlots`에 남아 있는 슬롯만 동기 패치로 채웁니다(영화 제목은 호출부에서 KOBIS).
 */
export function buildDeferChoiceMeetingCreatePatch(opts: {
  raw: string;
  missingSlots: readonly MeetingCreateNluMissingSlot[];
  categoryId: string;
}): Record<string, unknown> {
  if (!isDeferUserChoiceUtterance(opts.raw)) return {};
  const miss = new Set(opts.missingSlots);
  const seed = `${opts.categoryId.trim()}:${normUtterance(opts.raw)}`;
  const out: Record<string, unknown> = {};

  if (miss.has('menuPreference')) {
    out.menuPreferenceLabel = pickDeterministicMenuPreferenceForDefer(seed);
  }
  if (miss.has('activityKind')) {
    out.activityKindLabel = pickDeterministicActivityKindForDefer(seed);
  }
  if (miss.has('gameKind')) {
    out.gameKindLabel = pickDeterministicGameKindForDefer(seed);
  }
  if (miss.has('pcGameKind')) {
    out.pcGameKindLabel = pickDeterministicPcGameKindForDefer(seed);
  }
  if (miss.has('focusKnowledge')) {
    out.focusKnowledgeLabel = pickDeterministicFocusKnowledgeForDefer(seed);
  }

  return out;
}

export type MovieRankLineInput = { title: string; kobisRank?: string | null };

/** `moviePick` 재촉 본문 뒤에 박스오피스 1~3위 안내를 붙입니다(영화 3개일 때만). */
export function appendMovieNudgeBoxOfficeRanks(
  baseNudge: string,
  movies: readonly MovieRankLineInput[],
): string {
  if (movies.length < 3) return baseNudge;
  const top3 = movies.slice(0, 3);
  const lines = top3.map((m, idx) => {
    const rk = (m.kobisRank ?? '').trim() || String(idx + 1);
    const title = (m.title ?? '').trim();
    return `${rk}위 · ${title}`;
  });
  return `${baseNudge}\n\n오늘 기준 박스오피스 상위작이에요.\n${lines.join('\n')}\n\n1·2·3 중 편한 번호나 제목을 말씀해 주세요. 정말 상관없으면 아무거나라고 해 주시면 1위 작품으로 맞출게요.`;
}

export type PendingNluBoxOfficePickTitle = { title: string };

/**
 * 직전 안내에 나온 박스오피스 1~3위에 대해, 사용자가 순위만 말한 경우 Edge 대신 제목 슬롯을 채웁니다.
 * `headcount` 결손이 같이 있을 때 `1`~`3` 한 자리는 인원으로 오해될 수 있어 생략하고, `1위` 등은 허용합니다.
 */
export function tryPatchMovieTitleFromBoxOfficeRankReply(
  raw: string,
  topThree: readonly PendingNluBoxOfficePickTitle[] | null | undefined,
  missingSlots: readonly MeetingCreateNluMissingSlot[],
): { primaryMovieTitle: string; movieTitleHints: string[] } | null {
  if (!topThree || topThree.length < 3) return null;
  const t = normUtterance(raw);
  if (t.length === 0 || t.length > 48) return null;

  const headcountAlsoMissing = missingSlots.includes('headcount');
  const idx = parseBoxOfficeRankChoiceIndex(t, { allowBare123: !headcountAlsoMissing });
  if (idx === null || idx < 0 || idx > 2) return null;

  const title = (topThree[idx]?.title ?? '').trim();
  if (!title) return null;
  return { primaryMovieTitle: title, movieTitleHints: [title] };
}

function parseBoxOfficeRankChoiceIndex(
  s: string,
  opts: { allowBare123: boolean },
): number | null {
  if (opts.allowBare123 && /^[123１２３]$/.test(s)) {
    const map: Record<string, number> = { '1': 0, '2': 1, '3': 2, '１': 0, '２': 1, '３': 2 };
    return map[s] ?? null;
  }
  if (/^[123]\s*[.．。]$/.test(s) && opts.allowBare123) {
    return parseInt(s[0]!, 10) - 1;
  }

  const mW = s.match(/^([123])\s*위/u);
  if (mW) return parseInt(mW[1]!, 10) - 1;

  const mB = s.match(/^([123])\s*번/u);
  if (mB) return parseInt(mB[1]!, 10) - 1;

  if (/^일\s*위/u.test(s)) return 0;
  if (/^이\s*위/u.test(s)) return 1;
  if (/^삼\s*위/u.test(s)) return 2;

  if (/^첫\s*번째/u.test(s) || /^첫째/u.test(s)) return 0;
  if (/^두\s*번째/u.test(s) || /^둘째/u.test(s)) return 1;
  if (/^세\s*번째/u.test(s) || /^셋째/u.test(s)) return 2;

  return null;
}
