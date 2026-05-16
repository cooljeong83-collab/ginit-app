import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

/** 모임 상세(`Meeting`) JSON 스냅샷 — TanStack Query fetch 후 로컬 퍼스트 UI 소스. */
export class CachedMeetingDetail extends Model {
  static table = 'cached_meeting_details' as const;

  @field('meeting_json') meetingJson!: string;
  @field('synced_at_ms') syncedAtMs!: number;
}
