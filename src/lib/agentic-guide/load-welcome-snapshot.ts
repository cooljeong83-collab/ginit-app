import { splitGDnaChips } from '@/src/lib/friend-presence-activity';
import { fetchMyMeetingsForFeedFromSupabase } from '@/src/lib/supabase-meetings-list';
import { ensureNearbySearchBias } from '@/src/lib/nearby-search-bias';
import { getUserProfile } from '@/src/lib/user-profile';
import type { Meeting } from '@/src/lib/meetings';
import type { UserProfile } from '@/src/lib/user-profile';
import { fetchOpenMeteoCurrent } from '@/src/lib/agentic-guide/fetch-open-meteo-current';
import { wmoCodeToAgentWeatherMood } from '@/src/lib/agentic-guide/map-wmo-to-agent-weather';
import { pickAgentTimeSlot } from '@/src/lib/agentic-guide/pick-time-slot';
import { pickOngoingMeetingsChatHint } from '@/src/lib/agentic-guide/pick-next-ongoing-meeting-for-chat';
import { summarizeRecentMeetings } from '@/src/lib/agentic-guide/summarize-recent-meetings';
import type { AgentWelcomeSnapshot, AgentWeatherMood } from '@/src/lib/agentic-guide/types';

function displayFromProfile(p: UserProfile | null): string | null {
  if (!p) return null;
  const d = (p.displayName ?? '').trim();
  if (d) return d;
  return (p.nickname ?? '').trim() || null;
}

function virtualWeatherForSlot(slot: ReturnType<typeof pickAgentTimeSlot>): {
  weatherMood: AgentWeatherMood;
  temperatureC: number | null;
} {
  switch (slot) {
    case 'morning':
      return { weatherMood: 'clear', temperatureC: 18 };
    case 'lunch':
      return { weatherMood: 'cloudy', temperatureC: 24 };
    case 'afternoon':
      return { weatherMood: 'wind', temperatureC: 26 };
    case 'evening':
      return { weatherMood: 'clear', temperatureC: 21 };
    default:
      return { weatherMood: 'cloudy', temperatureC: 16 };
  }
}

export async function loadWelcomeSnapshot(appUserId: string | null | undefined): Promise<AgentWelcomeSnapshot> {
  const now = new Date();
  const timeSlot = pickAgentTimeSlot(now);
  const vw = virtualWeatherForSlot(timeSlot);

  let profile: UserProfile | null = null;
  let meetings: Meeting[] = [];

  const uid = appUserId?.trim() ?? '';
  if (uid) {
    const [pr, mr] = await Promise.allSettled([getUserProfile(uid), fetchMyMeetingsForFeedFromSupabase(uid)]);
    if (pr.status === 'fulfilled') profile = pr.value;
    if (mr.status === 'fulfilled' && mr.value.ok) meetings = mr.value.meetings;
  }

  const displayName = displayFromProfile(profile);
  const gDnaChips = splitGDnaChips(profile?.gDna ?? null, 2);
  const profileMeetingCount =
    typeof profile?.meetingCount === 'number' && Number.isFinite(profile.meetingCount)
      ? Math.trunc(profile.meetingCount)
      : null;

  let locationHint: string | null = null;
  let weatherMood = vw.weatherMood;
  let temperatureC = vw.temperatureC;

  try {
    const { bias, coords } = await ensureNearbySearchBias();
    locationHint = bias?.trim() ? bias.trim() : null;
    if (coords) {
      const cur = await fetchOpenMeteoCurrent(coords);
      if (cur) {
        weatherMood = wmoCodeToAgentWeatherMood(cur.wmoCode);
        temperatureC = cur.temperatureC;
      }
    }
  } catch {
    /* keep virtual */
  }

  const recentSummary = summarizeRecentMeetings(meetings);
  const ongoingChatHint = pickOngoingMeetingsChatHint(meetings, now);

  return {
    now,
    timeSlot,
    displayName,
    gDnaChips,
    profileMeetingCount,
    locationHint,
    weatherMood,
    temperatureC,
    recentMeetings: meetings,
    recentSummary,
    ongoingChatHint,
    profile,
  };
}
