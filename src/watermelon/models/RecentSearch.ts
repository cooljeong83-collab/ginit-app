import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export class RecentSearch extends Model {
  static table = 'recent_searches' as const;

  @field('scope') scope!: string;
  @field('room_id') roomId!: string | null;
  @field('query') query!: string;
  @field('last_used_at_ms') lastUsedAtMs!: number;
  @field('use_count') useCount!: number | null;
}

