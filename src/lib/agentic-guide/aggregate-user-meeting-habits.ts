import { getPolicy } from '@/src/lib/app-policies-store';
import type { Meeting, ParticipantVoteSnapshot } from '@/src/lib/meetings';
import { patternLabelFromMeeting } from '@/src/lib/agentic-guide/summarize-recent-meetings';
import type { UserMeetingHabitsAggregate, WeightedPlaceHit } from '@/src/lib/agentic-guide/types';

type HabitsWeights = {
  lightning_max_gap_days: number;
  roll_weeks: number;
  weight_confirmed: number;
  weight_user_vote: number;
  weight_tally: number;
  weight_display: number;
};

const HABITS_POLICY_DEFAULT: HabitsWeights = {
  lightning_max_gap_days: 1,
  roll_weeks: 8,
  weight_confirmed: 5,
  weight_user_vote: 3,
  weight_tally: 1,
  weight_display: 1,
};

function readHabitsWeights(): HabitsWeights {
  const raw = getPolicy<unknown>('agentic_guide', 'meeting_habits', HABITS_POLICY_DEFAULT);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return HABITS_POLICY_DEFAULT;
  const o = raw as Record<string, unknown>;
  const num = (k: keyof HabitsWeights, d: number) => {
    const v = o[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : d;
  };
  return {
    lightning_max_gap_days: num('lightning_max_gap_days', HABITS_POLICY_DEFAULT.lightning_max_gap_days),
    roll_weeks: Math.max(1, Math.min(52, Math.trunc(num('roll_weeks', HABITS_POLICY_DEFAULT.roll_weeks)))),
    weight_confirmed: Math.max(0, num('weight_confirmed', HABITS_POLICY_DEFAULT.weight_confirmed)),
    weight_user_vote: Math.max(0, num('weight_user_vote', HABITS_POLICY_DEFAULT.weight_user_vote)),
    weight_tally: Math.max(0, num('weight_tally', HABITS_POLICY_DEFAULT.weight_tally)),
    weight_display: Math.max(0, num('weight_display', HABITS_POLICY_DEFAULT.weight_display)),
  };
}

/** `meetings.ts` `buildMeetingVoteChipLists`의 장소 칩 id 규칙과 동일(에이전트 전용, RN 의존 없음). */
function buildAgentPlaceChipIds(m: Meeting): string[] {
  const places = m.placeCandidates ?? [];
  let placeChipIds = places.map((p, i) => {
    const pid = typeof p.id === 'string' ? p.id.trim() : '';
    return pid || `pc-${i}`;
  });
  if (placeChipIds.length === 0) {
    const name = m.placeName?.trim() || m.location?.trim();
    const addr = m.address?.trim();
    if (name || addr) {
      placeChipIds = ['legacy-place'];
    }
  }
  return placeChipIds;
}

function getVoteSnapForUser(m: Meeting, appUserId: string): ParticipantVoteSnapshot | null {
  const ns = appUserId.trim().toLowerCase();
  if (!ns) return null;
  const log = m.participantVoteLog ?? [];
  for (const e of log) {
    const u = (e.userId ?? '').trim().toLowerCase();
    if (u === ns) return e;
  }
  return null;
}

function parseYmdLocal(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  const dt = new Date(y, mo - 1, d, 12, 0, 0, 0);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function meetingAnchorDate(m: Meeting): Date | null {
  const ymd = (m.scheduleDate ?? '').trim();
  if (ymd) {
    const d = parseYmdLocal(ymd);
    if (d) return d;
  }
  const ca = m.createdAt?.toDate?.() ?? null;
  if (ca && Number.isFinite(ca.getTime())) return ca;
  return null;
}

function isWeekendDate(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function placeLabelFromChip(m: Meeting, chipId: string): string | null {
  const id = chipId.trim();
  if (!id) return null;
  const lists = buildAgentPlaceChipIds(m);
  const idx = lists.indexOf(id);
  if (idx >= 0) {
    const row = m.placeCandidates?.[idx];
    if (row) {
      const n = (row.placeName ?? '').trim();
      const a = (row.address ?? '').trim();
      if (n) return n;
      if (a) return a;
    }
  }
  if (id === 'legacy-place') {
    const n = (m.placeName ?? '').trim() || (m.location ?? '').trim() || (m.address ?? '').trim();
    return n || null;
  }
  return null;
}

function addPlaceScore(
  acc: Map<string, { display: string; search: string; score: number }>,
  label: string | null,
  delta: number,
) {
  const t = (label ?? '').trim();
  if (t.length < 2) return;
  const key = t.toLowerCase();
  const prev = acc.get(key);
  if (prev) prev.score += delta;
  else acc.set(key, { display: t, search: t, score: delta });
}

function nextSaturdayYmd(now: Date): string | null {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  const day = d.getDay();
  const add = (6 - day + 7) % 7;
  const sat = new Date(d);
  sat.setDate(d.getDate() + add);
  const y = sat.getFullYear();
  const mo = String(sat.getMonth() + 1).padStart(2, '0');
  const da = String(sat.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/**
 * 참여 모임 목록으로 습관 집계. `appUserId`는 본인 장소 투표 매칭에 사용.
 */
export function aggregateUserMeetingHabits(
  meetings: Meeting[],
  now: Date,
  appUserId: string | null | undefined,
): UserMeetingHabitsAggregate | null {
  const slice = meetings.slice(0, 120);
  if (slice.length === 0) return null;

  const w = readHabitsWeights();
  const uid = (appUserId ?? '').trim();

  let fsRich = 0;
  const placeAcc = new Map<string, { display: string; search: string; score: number }>();

  for (const m of slice) {
    const hasFs =
      Boolean(m.placeCandidates?.length) ||
      Boolean(m.participantVoteLog?.length) ||
      Boolean(m.dateCandidates?.length);
    if (hasFs) fsRich += 1;

    if (m.scheduleConfirmed === true) {
      const cid = (m.confirmedPlaceChipId ?? '').trim();
      if (cid) {
        const lab = placeLabelFromChip(m, cid);
        addPlaceScore(placeAcc, lab, w.weight_confirmed);
      }
    }

    if (uid) {
      const snap = getVoteSnapForUser(m, uid);
      for (const chip of snap?.placeChipIds ?? []) {
        const lab = placeLabelFromChip(m, chip.trim());
        addPlaceScore(placeAcc, lab, w.weight_user_vote);
      }
    }

    const vt = m.voteTallies?.places;
    if (vt && typeof vt === 'object') {
      const lists = buildAgentPlaceChipIds(m);
      for (const chipId of lists) {
        const votes = vt[chipId] ?? 0;
        if (votes > 0) {
          const lab = placeLabelFromChip(m, chipId);
          addPlaceScore(placeAcc, lab, w.weight_tally * Math.min(votes, 5));
        }
      }
    }

    const pn = (m.placeName ?? '').trim() || (m.location ?? '').trim();
    if (pn) addPlaceScore(placeAcc, pn, w.weight_display);
  }

  const topPlaces: WeightedPlaceHit[] = [...placeAcc.values()]
    .sort((a, b) => b.score - a.score || a.display.localeCompare(b.display))
    .slice(0, 8)
    .map((x) => ({ displayQuery: x.display, searchQuery: x.search, score: x.score }));

  let weekendCount = 0;
  let datedCount = 0;
  const weekendLabelFreq = new Map<string, number>();
  const anchorDates: Date[] = [];

  for (const m of slice) {
    const d = meetingAnchorDate(m);
    if (!d) continue;
    anchorDates.push(d);
    datedCount += 1;
    if (isWeekendDate(d)) {
      weekendCount += 1;
      const lab = patternLabelFromMeeting(m);
      if (lab && lab !== '모임') weekendLabelFreq.set(lab, (weekendLabelFreq.get(lab) ?? 0) + 1);
    }
  }

  const weekendDayPortion = datedCount > 0 ? weekendCount / datedCount : null;
  let weekendTopCategoryLabel: string | null = null;
  let weekendTopCategoryCount = 0;
  for (const [lab, c] of weekendLabelFreq) {
    if (c > weekendTopCategoryCount) {
      weekendTopCategoryCount = c;
      weekendTopCategoryLabel = lab;
    }
  }

  anchorDates.sort((a, b) => a.getTime() - b.getTime());
  let shortGapPairs = 0;
  let gapPairs = 0;
  for (let i = 1; i < anchorDates.length; i++) {
    const a0 = anchorDates[i - 1]!;
    const a1 = anchorDates[i]!;
    const days = Math.abs(Math.round((a1.getTime() - a0.getTime()) / 86400000));
    gapPairs += 1;
    if (days <= w.lightning_max_gap_days) shortGapPairs += 1;
  }
  const lightningScore = gapPairs > 0 ? shortGapPairs / gapPairs : null;

  const rollMs = w.roll_weeks * 7 * 86400000;
  const cutoff = now.getTime() - rollMs;
  let inWindow = 0;
  for (const d of anchorDates) {
    if (d.getTime() >= cutoff) inWindow += 1;
  }
  const meetingsPerWeekAvg = w.roll_weeks > 0 ? inWindow / w.roll_weeks : null;

  return {
    sampledMeetingCount: slice.length,
    weekendDayPortion,
    weekendTopCategoryLabel,
    weekendTopCategoryCount,
    lightningScore,
    meetingsPerWeekAvg,
    topPlaces,
    nextSaturdayYmd: nextSaturdayYmd(now),
    dataCompletenessFsShare: slice.length > 0 ? fsRich / slice.length : 0,
  };
}
