import type { OfflineChatRoomKey } from '@/src/lib/offline-chat/offline-chat-types';
import { normalizeRoomKey } from '@/src/lib/offline-chat/offline-chat-types';

export type RemoteSearchIndexChunk = {
  chunkId: string;
  rangeStartAtMs: number | null;
  rangeEndAtMs: number | null;
  chunkText: string;
};

/** 향후 마이그레이션: `chat_pull_search_index_chunks(p_me, p_room_kind, p_room_id, p_chunk_ids)` */
export const CHAT_PULL_SEARCH_INDEX_CHUNKS_RPC = 'chat_pull_search_index_chunks';

let didLogChunkRpcStub = false;

/**
 * Supabase 검색 인덱스 chunk RPC 포트(스텁).
 * RPC 미배포 시 빈 배열을 반환하며, 로컬에 빈 placeholder chunk를 쓰지 않습니다.
 */
export async function fetchSearchIndexChunksFromSupabase(args: {
  meAppUserId: string;
  key: OfflineChatRoomKey;
  chunkIds: string[];
}): Promise<{ chunks: RemoteSearchIndexChunk[]; error?: string }> {
  const me = args.meAppUserId.trim();
  const k = normalizeRoomKey(args.key);
  const ids = [...new Set(args.chunkIds.map((id) => String(id ?? '').trim()).filter(Boolean))];
  if (!me || !k.roomId || ids.length === 0) return { chunks: [] };

  if (__DEV__ && !didLogChunkRpcStub) {
    didLogChunkRpcStub = true;
    console.log(
      `[chat-search-index-chunk-port] ${CHAT_PULL_SEARCH_INDEX_CHUNKS_RPC} not deployed; chunk backfill skipped`,
    );
  }

  return { chunks: [] };
}
