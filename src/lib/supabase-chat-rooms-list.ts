/**
 * Supabase `chat_rooms` + RPC `chat_rooms_list_page` — 친구(1:1) 채팅방 목록 페이지.
 * 테이블이 비어 있거나 RPC 실패 시 Firestore `chat_rooms` 전체 스냅샷을 정렬·슬라이스하는 폴백을 사용합니다.
 */
import { collection, getDocs, query, where, type Timestamp } from 'firebase/firestore';

import { getFirebaseFirestore } from '@/src/lib/firebase';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { CHAT_ROOMS_COLLECTION, type SocialChatRoomSummary } from '@/src/lib/social-chat-rooms';
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

function sortKeyFromRoomDoc(data: Record<string, unknown>): number {
  const ua = data.updatedAt ?? data.updated_at;
  if (ua && typeof (ua as Timestamp).toMillis === 'function') {
    try {
      return (ua as Timestamp).toMillis();
    } catch {
      return 0;
    }
  }
  const ca = data.createdAt ?? data.created_at;
  if (ca && typeof (ca as Timestamp).toMillis === 'function') {
    try {
      return (ca as Timestamp).toMillis();
    } catch {
      return 0;
    }
  }
  return 0;
}

/** RPC/테이블 미적용 환경용 — 기존 Firestore 쿼리로 전체 로드 후 메모리 페이징 */
export async function fetchChatRoomsListPageFirestoreFallback(
  myAppUserId: string,
  pageParam: number,
): Promise<{ rooms: SocialChatRoomSummary[]; hasMore: boolean }> {
  const me = (normalizePhoneUserId(myAppUserId) ?? myAppUserId).trim();
  if (!me) return { rooms: [], hasMore: false };
  const q = query(
    collection(getFirebaseFirestore(), CHAT_ROOMS_COLLECTION),
    where('participantIds', 'array-contains', me),
  );
  const snap = await getDocs(q);
  type Row = SocialChatRoomSummary & { _sort: number };
  const rows: Row[] = [];
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    if (data.isGroup === true) continue;
    const ids = Array.isArray(data.participantIds)
      ? (data.participantIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      : [];
    const peer = ids.find((x) => (normalizePhoneUserId(x) ?? x) !== me) ?? '';
    if (!peer) continue;
    rows.push({
      roomId: d.id,
      peerAppUserId: normalizePhoneUserId(peer) ?? peer,
      _sort: sortKeyFromRoomDoc(data),
    });
  }
  rows.sort((a, b) => b._sort - a._sort || b.roomId.localeCompare(a.roomId));
  const from = pageParam * CHAT_ROOMS_LIST_PAGE_SIZE;
  const slice = rows.slice(from, from + CHAT_ROOMS_LIST_PAGE_SIZE).map(({ roomId, peerAppUserId }) => ({
    roomId,
    peerAppUserId,
  }));
  return { rooms: slice, hasMore: from + CHAT_ROOMS_LIST_PAGE_SIZE < rows.length };
}

export async function fetchChatRoomsListPageHybrid(
  userId: string,
  pageParam: number,
): Promise<{ rooms: SocialChatRoomSummary[]; hasMore: boolean }> {
  const me = userId.trim();
  if (!me) return { rooms: [], hasMore: false };

  const [blocked, res] = await Promise.all([
    fetchBlockedPeerIds(me).catch(() => new Set<string>()),
    (async () => {
      try {
        const r = await fetchChatRoomsListPageFromSupabase(me, pageParam);
        if (pageParam === 0 && r.rooms.length === 0) {
          const fb = await fetchChatRoomsListPageFirestoreFallback(me, pageParam);
          if (fb.rooms.length > 0) return fb;
        }
        return r;
      } catch {
        return fetchChatRoomsListPageFirestoreFallback(me, pageParam);
      }
    })(),
  ]);

  if (blocked.size === 0) return res;
  const rooms = res.rooms.filter((r) => !blocked.has(r.peerAppUserId.trim()));
  return { rooms, hasMore: res.hasMore };
}

/**
 * DM(`is_group=false`) 채팅방 요약 변경 시 콜백.
 * - RLS(`chat_rooms_select_participant`, migration 0133)로 "내 participant_ids 포함 행"만 서버에서 전달됩니다.
 * - `event: '*'` 대신 INSERT/UPDATE/DELETE만 구독합니다.
 */
export function subscribeChatRoomsListInvalidate(
  viewerAppUserId: string,
  onInvalidate: () => void,
  onError?: (message: string) => void,
): () => void {
  const me = viewerAppUserId.trim();
  if (!me) return () => {};

  let cancelled = false;
  const channel = supabase.channel(`realtime:chat-rooms-list:${me}:${Date.now()}:${Math.random().toString(36).slice(2)}`);

  const fire = () => {
    if (!cancelled) onInvalidate();
  };

  const dmOnly = 'is_group=eq.false';
  for (const event of ['INSERT', 'UPDATE', 'DELETE'] as const) {
    channel.on('postgres_changes', { event, schema: 'public', table: 'chat_rooms', filter: dmOnly }, fire);
  }

  void channel.subscribe((status) => {
    if (status === 'CHANNEL_ERROR') {
      onError?.('Supabase Realtime(chat_rooms) 연결 오류');
    }
  });

  return () => {
    cancelled = true;
    void supabase.removeChannel(channel);
  };
}
