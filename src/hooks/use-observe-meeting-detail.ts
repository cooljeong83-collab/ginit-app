import { Q } from '@nozbe/watermelondb';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { deserializeMeetingFromJson } from '@/src/lib/meeting-detail-watermelon-cache';
import type { Meeting } from '@/src/lib/meetings';
import { CachedMeetingDetail } from '@/src/watermelon/models/CachedMeetingDetail';
import { database } from '@/src/watermelon';

export type ObserveMeetingDetailState = {
  /** `undefined` = 아직 로컬 행 미확인(초기 구독 전), `null` = 로컬에 없음, 객체 = 캐시 스냅샷 */
  meeting: Meeting | null | undefined;
  hasLocalRow: boolean;
};

/**
 * 모임 상세 UI용 Watermelon 구독.
 * 웹(`database === null`)에서는 항상 `meeting: undefined`, `hasLocalRow: false`.
 */
export function useObserveMeetingDetail(meetingId: string): ObserveMeetingDetailState {
  const id = typeof meetingId === 'string' ? meetingId.trim() : '';
  const [meeting, setMeeting] = useState<Meeting | null | undefined>(undefined);
  const [hasLocalRow, setHasLocalRow] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web' || !database || !id) {
      setMeeting(undefined);
      setHasLocalRow(false);
      return;
    }

    const db = database;
    const col = db.get<CachedMeetingDetail>('cached_meeting_details');
    const query = col.query(Q.where('id', id));

    const applyRows = (rows: CachedMeetingDetail[]) => {
      const row = rows[0];
      if (!row) {
        setHasLocalRow(false);
        setMeeting(null);
        return;
      }
      setHasLocalRow(true);
      setMeeting(deserializeMeetingFromJson(row.meetingJson));
    };

    const sub = query.observeWithColumns(['meeting_json', 'synced_at_ms']).subscribe({
      next: applyRows,
      error: () => {
        setHasLocalRow(false);
        setMeeting(null);
      },
    });

    return () => sub.unsubscribe();
  }, [id]);

  return { meeting, hasLocalRow };
}
