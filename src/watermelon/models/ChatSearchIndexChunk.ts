import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export class ChatSearchIndexChunk extends Model {
  static table = 'chat_search_index_chunks' as const;

  @field('room_id') roomId!: string;
  @field('room_type') roomType!: string;
  @field('chunk_id') chunkId!: string;

  @field('range_start_at_ms') rangeStartAtMs!: number | null;
  @field('range_end_at_ms') rangeEndAtMs!: number | null;
  @field('chunk_text') chunkText!: string;
  @field('fetched_at_ms') fetchedAtMs!: number | null;
}

