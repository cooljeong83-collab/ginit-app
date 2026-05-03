import { isColdStartForAgentSnapshot } from '@/src/lib/agentic-guide/cold-start';
import { isOngoingForChat } from '@/src/lib/agentic-guide/pick-next-ongoing-meeting-for-chat';
import { isUsefulMeetingPatternLabel, topUsefulPatternInMeetings } from '@/src/lib/agentic-guide/summarize-recent-meetings';
import type { AgentTimeSlot, AgentWelcomeSnapshot } from '@/src/lib/agentic-guide/types';

function pickUsefulTopPair(sum: AgentWelcomeSnapshot['recentSummary']): { top: string; second: string | null } | null {
  const labels = (sum?.topCategoryLabels ?? [])
    .map((x) => x.trim())
    .filter(isUsefulMeetingPatternLabel);
  if (labels.length === 0) return null;
  const top = labels[0];
  const second = labels.length > 1 && labels[1] !== top ? labels[1] : null;
  return { top, second };
}

function timeSlotLabelKo(slot: AgentTimeSlot): string {
  switch (slot) {
    case 'morning':
      return '아침';
    case 'lunch':
      return '점심';
    case 'afternoon':
      return '오후';
    case 'evening':
      return '저녁';
    case 'night':
      return '밤';
    default:
      return '오늘';
  }
}

/**
 * `/create/details` 첫 말풍선 — 환영 인사 없이 패턴·제안만.
 */
export function buildDetailsPatternSuggestMessage(s: AgentWelcomeSnapshot): string {
  const sum = s.recentSummary;
  const pair = pickUsefulTopPair(sum);
  const dna = s.gDnaChips.slice(0, 2).join('·');
  const dnaBit = dna ? ` 성향 ${dna} 느낌이라` : '';

  if (pair) {
    const secondBit = pair.second ? `, ${pair.second}도 자주 썼고` : '';
    return `기록 보면 ${pair.top}${secondBit}${dnaBit} 오늘도 그 라인으로 갈래? ✨ 수락 누르면 바로 맞춰 줄게 🙌`;
  }

  const feedN = sum?.meetingCountSample ?? s.recentMeetings.length;
  const lastTitle = sum?.lastTitle?.trim();
  const usefulLast = lastTitle && lastTitle !== '모임' ? lastTitle : null;

  if (feedN > 0 && usefulLast) {
    return `최근 ${usefulLast} 기억나${dnaBit} ✨ 오늘도 비슷한 무드로 갈래? 수락 누르면 맞춰 줄게 🙌`;
  }

  if (feedN > 0) {
    return `이미 모임 꽤 돌려왔네${dnaBit} ✨ 이번엔 추천 카테고리로 바로 깔아볼래? 수락 누르면 세팅해 줄게 🙌`;
  }

  const profileN = s.profileMeetingCount;
  /** `meeting_count` 미동기·미세팅(null)이면 첫 모임 멘트로 오인하지 않음 */
  const strictFirstTimer = typeof profileN === 'number' && profileN === 0;

  if (strictFirstTimer) {
    return `첫 모임 각이면 일단 분위기부터 잡아보자 ✨ 수락 누르면 추천 카테고리로 세팅해 줄게 🙌`;
  }

  if (typeof profileN === 'number' && profileN > 0) {
    return `활동 기록은 있는데 목록은 아직 비어 보여${dnaBit} ✨ 수락 누르면 추천 카테고리로 바로 잡아줄게 🙌`;
  }

  return `모임 패턴은 아직 수집 중이야${dnaBit} ✨ 수락 누르면 추천으로 세팅해 볼래? 🙌`;
}

/**
 * 위저드 1단계(카테고리) — 참여 중·완료 모임을 나눠 세밀한 제안 멘트.
 */
export function buildStep1FrequentPatternOfferMessage(s: AgentWelcomeSnapshot): string {
  if (isColdStartForAgentSnapshot(s)) {
    const name = s.displayName?.trim();
    const greet = name ? `${name}님, ` : '';
    return `${greet}첫 모임이네요, 반가워요. \n지금 단계에서는 모임 종류만 골라 주세요. \n아래로 단계마다 내용을 짧게 설명해 줄게요. \n부담 없이 본인 취향대로 선택하면 돼요.`;
  }

  const acceptHint = ' 수락 누르면 맞춰 줄게 🙌';
  const now = s.now;
  const meetings = s.recentMeetings ?? [];
  const ongoing = meetings.filter((m) => isOngoingForChat(m, now));
  const completed = meetings.filter((m) => !isOngoingForChat(m, now));

  const dna = s.gDnaChips.slice(0, 2).join('·');
  const dnaBit = dna ? ` 네 성향(${dna})도 같이 보면` : '';

  if (completed.length > 0) {
    const topDone = topUsefulPatternInMeetings(completed);
    const slotKo = timeSlotLabelKo(s.timeSlot);
    if (topDone) {
      const { label } = topDone;
      return `완료된 모임 기록을 보면 ${label} 쪽을 많이 하셨네요. 오늘 ${slotKo} ${label} 모임을 만들어 드릴까요?${acceptHint}`;
    }
    return `완료된 모임이 ${completed.length}건 있어요.${dnaBit} 자주 하던 라인으로 새 모임 잡아 드릴까요?${acceptHint}`;
  }

  if (ongoing.length > 0) {
    const n = ongoing.length;
    const nStr = String(n);
    const topLive = topUsefulPatternInMeetings(ongoing);

    if (topLive && topLive.count >= 2 && topLive.count === n) {
      return `지금까지 완료된 모임은 없고, ${nStr}개의 모임에 참여 중이시네요~ 모두 ${topLive.label} 모임이에요. ${topLive.label} 모임 생성을 도와드릴까요?${acceptHint}`;
    }
    if (topLive && topLive.count >= 2) {
      return `지금까지 완료된 모임은 없고, ${nStr}개의 모임에 참여 중이시네요~ ${nStr}개 중 ${topLive.count}개가 ${topLive.label} 모임인데, ${topLive.label} 모임 생성을 도와드릴까요?${acceptHint}`;
    }
    if (topLive && n === 1) {
      return `지금까지 완료된 모임은 없고, 참여 중인 모임이 1개네요. 지금 모임이 ${topLive.label} 계열인데, 비슷한 ${topLive.label} 모임도 만들어 드릴까요?${acceptHint}`;
    }
    if (n >= 2) {
      const tail = topLive?.label ? ` 그중 ${topLive.label}도 있고요.` : '';
      return `지금까지 완료된 모임은 없고, ${nStr}개의 모임에 참여 중이시네요~${tail} 오늘은 어떤 카테고리로 잡아 드릴까요?${acceptHint}`;
    }
    if (n === 1) {
      return `지금까지 완료된 모임은 없고, 참여 중인 모임이 1개네요.${dnaBit} 그 톤으로 새 모임 잡아 드릴까요?${acceptHint}`;
    }
  }

  const sum = s.recentSummary;
  const pair = pickUsefulTopPair(sum);

  if (pair) {
    const secondBit = pair.second ? `, ${pair.second}도 자주 쓰고` : '';
    return `참여 중이거나 지나왔던 모임 기록을 보면 ${pair.top}${secondBit} 쪽을 자주 썼어.${dnaBit} 그 패턴(자주 하던 모임 느낌)으로 이번에도 만들어 줄까?${acceptHint}`;
  }

  const feedN = sum?.meetingCountSample ?? s.recentMeetings.length;
  const lastTitle = sum?.lastTitle?.trim();
  const usefulLast = lastTitle && lastTitle !== '모임' ? lastTitle : null;

  if (feedN > 0 && usefulLast) {
    return `참여했던 모임들을 훑어보면 ${usefulLast} 무드가 눈에 띄어${dnaBit}. 비슷하게 자주 하던 쪽으로 이번 모임도 세팅해 줄까?${acceptHint}`;
  }

  if (feedN > 0) {
    return `참여·지나온 모임을 기준으로 보면 꽤 돌려왔네${dnaBit}. 자주 쓰던 톤으로 새 모임 만들어 줄까?${acceptHint}`;
  }

  const profileN = s.profileMeetingCount;
  const strictFirstTimer = typeof profileN === 'number' && profileN === 0;

  if (strictFirstTimer) {
    return `아직 참여 기록이 거의 없어서 패턴 분석은 가볍게 가도 돼${dnaBit}. 일단 추천 카테고리로 같이 시작해 볼래?${acceptHint}`;
  }

  if (typeof profileN === 'number' && profileN > 0) {
    return `참여 기록은 있는데 목록은 아직 비어 보여${dnaBit}. 자주 가던 라인을 짐작해서 잡아볼까?${acceptHint}`;
  }

  return `참여·지나온 모임 신호가 아직 얇아서 패턴은 천천히 쌓을게${dnaBit}. 그래도 오늘은 추천으로 바로 잡아볼래?${acceptHint}`;
}
