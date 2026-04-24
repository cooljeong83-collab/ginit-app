import type { Unsubscribe } from 'firebase/firestore';

import { meetingListSource } from '@/src/lib/hybrid-data-source';
import type { Meeting } from '@/src/lib/meetings';
import { fetchMeetingsOnce, subscribeMeetings } from '@/src/lib/meetings';
import { fetchPublicMeetingsFromSupabaseOnce, subscribeMeetingsFromSupabase } from '@/src/lib/supabase-meetings-list';

/**
 * 피드·지도·채팅 목록 등 — `EXPO_PUBLIC_MEETING_LIST_SOURCE=supabase` 이면 Supabase 공개 모임만 구독.
 * 기본은 Firestore `subscribeMeetings`.
 */
export function subscribeMeetingsHybrid(
  onData: (meetings: Meeting[]) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  if (meetingListSource() === 'supabase') {
    return subscribeMeetingsFromSupabase(onData, onError);
  }
  return subscribeMeetings(onData, onError);
}

/** `fetchMeetingsOnce` 와 동일 반환 형식 */
export async function fetchMeetingsOnceHybrid(): Promise<
  { ok: true; meetings: Meeting[] } | { ok: false; message: string }
> {
  if (meetingListSource() === 'supabase') {
    return fetchPublicMeetingsFromSupabaseOnce();
  }
  return fetchMeetingsOnce();
}
