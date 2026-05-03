import { describe, expect, it } from 'vitest';

import { isColdStartForAgentSnapshot } from './cold-start';
import type { AgentWelcomeSnapshot } from './types';

function baseSnap(over: Partial<AgentWelcomeSnapshot>): AgentWelcomeSnapshot {
  const now = new Date('2026-05-03T12:00:00');
  return {
    now,
    timeSlot: 'afternoon',
    displayName: null,
    gDnaChips: [],
    profileMeetingCount: 0,
    locationHint: null,
    weatherMood: 'clear',
    temperatureC: 20,
    recentMeetings: [],
    recentSummary: null,
    ongoingChatHint: { count: 0, nearestMeetingId: null, nearestTitle: null },
    profile: null,
    meetingHabits: null,
    ...over,
  };
}

describe('isColdStartForAgentSnapshot', () => {
  it('true when no feed and meetingCount is 0', () => {
    expect(isColdStartForAgentSnapshot(baseSnap({ profileMeetingCount: 0 }))).toBe(true);
  });

  it('false when meetingCount is null', () => {
    expect(isColdStartForAgentSnapshot(baseSnap({ profileMeetingCount: null }))).toBe(false);
  });

  it('false when feed has meetings', () => {
    expect(
      isColdStartForAgentSnapshot(
        baseSnap({
          profileMeetingCount: 0,
          recentMeetings: [{ id: '1', title: 't', location: '', description: '', capacity: 4 } as never],
        }),
      ),
    ).toBe(false);
  });
});
