/**
 * Supabase `chat_rooms` + RPC `chat_rooms_list_page` — 친구(1:1) 채팅방 목록 페이지.
 * 목록 실시간 무효화는 `user_notifications:{profiles.id}` Broadcast `refresh_list`(Edge) + `user-chat-list-refresh-bus` 를 사용합니다.
 */
import type { SocialChatRoomSummary } from '@/src/lib/social-chat-rooms';
import { supabase } from '@/src/lib/supabase';
import { fetchBlockedPeerIds } from '@/src/lib/user-blocks';

export const CHAT_ROOMS_LIST_PAGE_SIZE = 20;

type RpcPayload = {
  rooms?: { roomId?: string; peerAppUserId?: string }[];
  has_more?: boolean;
};

type ChatRoomSummaryRpcPayload = {
  rooms?: { roomId?: string; peerAppUserId?: string; changedAt?: string | null }[];
};

export type ChatRoomChangeSummary = SocialChatRoomSummary & {
  changedAtMs: number;
};

function mapRpcRooms(raw: unknown): SocialChatRoomSummary[] {
  if (!Array.isArray(raw)) return [];
  const out: SocialChatRoomSummary[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const roomId = typeof r.roomId === 'string' ? r.roomId.trim() : '';
    const peer = typeof r.peerAppUserId === 'string' ? r.peerAppUserId.trim() : '';
    if (roomId && peer) out.push({ roomId, peerAppUserId: peer });
  }
  return out;
}

function parseChangedAtMs(v: unknown): number {
  if (typeof v !== 'string') return 0;
  const d = new Date(v);
  const t = d.getTime();
  return Number.isFinite(t) ? t : 0;
}

function mapRpcRoomSummaries(raw: unknown): ChatRoomChangeSummary[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatRoomChangeSummary[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const roomId = typeof r.roomId === 'string' ? r.roomId.trim() : '';
    const peer = typeof r.peerAppUserId === 'string' ? r.peerAppUserId.trim() : '';
    if (roomId && peer) {
      out.push({
        roomId,
        peerAppUserId: peer,
        changedAtMs: parseChangedAtMs(r.changedAt),
      });
    }
  }
  return out;
}

export async function fetchChatRoomsChangeSummariesFromSupabase(
  userId: string,
): Promise<{ ok: true; summaries: ChatRoomChangeSummary[] } | { ok: false; message: string }> {
  const me = userId.trim();
  if (!me) return { ok: true, summaries: [] };
  const { data, error } = await supabase.rpc('chat_rooms_list_change_summaries', { p_me: me });
  if (error) return { ok: false, message: error.message };
  const payload = (data ?? {}) as ChatRoomSummaryRpcPayload;
  return { ok: true, summaries: mapRpcRoomSummaries(payload.rooms) };
}

export function diffChatRoomSummaries(
  cachedRooms: readonly SocialChatRoomSummary[],
  remoteSummaries: readonly ChatRoomChangeSummary[],
): boolean {
  if (cachedRooms.length !== remoteSummaries.length) return true;
  for (let i = 0; i < remoteSummaries.length; i += 1) {
    const cached = cachedRooms[i];
    const remote = remoteSummaries[i];
    if (!cached || !remote) return true;
    if (cached.roomId !== remote.roomId || cached.peerAppUserId !== remote.peerAppUserId) return true;
  }
  return false;
}

/** Supabase RPC — `.range`와 동등한 offset/limit(서버에서 21건까지 읽고 has_more 판단) */
export async function fetchChatRoomsListPageFromSupabase(
  userId: string,
  pageParam: number,
): Promise<{ rooms: SocialChatRoomSummary[]; hasMore: boolean }> {
  const me = userId.trim();
  if (!me) return { rooms: [], hasMore: false };
  const { data, error } = await supabase.rpc('chat_rooms_list_page', { p_me: me, p_page: pageParam });
  if (error) throw new Error(error.message);
  const payload = (data ?? {}) as RpcPayload;
  return {
    rooms: mapRpcRooms(payload.rooms),
    hasMore: Boolean(payload.has_more),
  };
}

export async function fetchChatRoomsListPageHybrid(
  userId: string,
  pageParam: number,
): Promise<{ rooms: SocialChatRoomSummary[]; hasMore: boolean }> {
  const me = userId.trim();
  if (!me) return { rooms: [], hasMore: false };

  const [blocked, res] = await Promise.all([
    fetchBlockedPeerIds(me).catch(() => new Set<string>()),
    fetchChatRoomsListPageFromSupabase(me, pageParam),
  ]);

  if (blocked.size === 0) return res;
  const rooms = res.rooms.filter((r) => !blocked.has(r.peerAppUserId.trim()));
  return { rooms, hasMore: res.hasMore };
}

