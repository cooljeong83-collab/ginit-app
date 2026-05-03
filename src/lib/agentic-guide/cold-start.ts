import type { AgentWelcomeSnapshot } from '@/src/lib/agentic-guide/types';

/**
 * 참여 피드가 비어 있고 프로필도 첫 모임으로 보일 때 — 패턴·카테고리 자동 추천을 끄는 엄격 모드.
 */
export function isColdStartForAgentSnapshot(s: AgentWelcomeSnapshot): boolean {
  const noFeed = (s.recentMeetings?.length ?? 0) === 0;
  const n = s.profileMeetingCount;
  const strictFirst = typeof n === 'number' && Number.isFinite(n) && n === 0;
  return noFeed && strictFirst;
}
