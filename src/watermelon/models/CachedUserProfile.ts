import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

/** `UserProfile` JSON 스냅샷 — id = `app_user_id`(정규화 PK). */
export class CachedUserProfile extends Model {
  static table = 'cached_user_profiles' as const;

  @field('profile_json') profileJson!: string;
  @field('synced_at_ms') syncedAtMs!: number;
}
