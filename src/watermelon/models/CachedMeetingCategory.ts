import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

/** Supabase `meeting_categories` 스냅샷 로컬 캐시(오프라인 퍼스트). */
export class CachedMeetingCategory extends Model {
  static table = 'cached_meeting_categories' as const;

  @field('label') label!: string;
  @field('emoji') emoji!: string;
  @field('sort_order') sortOrder!: number;
  @field('major_code') majorCode!: string | null;
}
