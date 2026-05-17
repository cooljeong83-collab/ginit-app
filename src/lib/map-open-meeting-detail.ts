import { readMeetingDetailFromWatermelon, upsertMeetingDetailToWatermelon } from '@/src/lib/meeting-detail-watermelon-cache';
import { getMeetingById } from '@/src/lib/meetings';

/** 지도 바텀시트·마커 → 상세: Watermelon hit 우선, miss 시 단건 fetch 후 upsert */
export async function prefetchMeetingDetailBeforeNavigate(meetingId: string): Promise<void> {
  const id = meetingId.trim();
  if (!id) return;
  const cached = await readMeetingDetailFromWatermelon(id);
  if (cached) return;
  const remote = await getMeetingById(id);
  await upsertMeetingDetailToWatermelon(id, remote);
}
