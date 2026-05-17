import type { ChatRoomKindDelta } from '@/src/lib/chat-supabase-delta';
import {
  pullMeetingChatReadPointersToLocal,
  scheduleDebouncedPullMeetingChatReadPointers,
} from '@/src/lib/meeting-chat-rooms-summary';
import {
  pullSocialChatReadPointersToLocal,
  scheduleDebouncedPullSocialChatReadPointers,
} from '@/src/lib/social-chat-read-pointers';

export type ChatBubbleReadPointersPullArgs = {
  roomKind: ChatRoomKindDelta;
  roomId: string;
  myAppUserId: string;
  ownerUserId?: string | null;
  peerUserId?: string | null;
  canonicalRoomId?: string | null;
  onMerged?: () => void;
};

/** 말풍선 읽음 맵 RPC pull (모임·DM 공통 진입점) */
export function pullChatBubbleReadPointersToLocal(args: ChatBubbleReadPointersPullArgs): Promise<void> {
  const rid = String(args.roomId ?? '').trim();
  const me = String(args.myAppUserId ?? '').trim();
  if (!rid || !me) return Promise.resolve();

  if (args.roomKind === 'meeting') {
    return pullMeetingChatReadPointersToLocal({
      meetingId: rid,
      myAppUserId: me,
      ownerUserId: args.ownerUserId,
      canonicalRoomId: args.canonicalRoomId,
      onMerged: args.onMerged,
    });
  }

  return pullSocialChatReadPointersToLocal({
    roomId: rid,
    myAppUserId: me,
    ownerUserId: args.ownerUserId,
    peerUserId: args.peerUserId,
    onMerged: args.onMerged,
  });
}

/**
 * 여러 Realtime·전송·읽음 경로가 겹쳐도 방당 debounce + in-flight 1회로 RPC를 합칩니다.
 * 방 진입 직후 최초 1회는 `pullChatBubbleReadPointersToLocal`을 직접 호출하세요.
 */
export function scheduleChatBubbleReadPointersPull(args: ChatBubbleReadPointersPullArgs, debounceMs = 300): void {
  const rid = String(args.roomId ?? '').trim();
  const me = String(args.myAppUserId ?? '').trim();
  if (!rid || !me) return;

  if (args.roomKind === 'meeting') {
    scheduleDebouncedPullMeetingChatReadPointers(
      {
        meetingId: rid,
        myAppUserId: me,
        ownerUserId: args.ownerUserId,
        canonicalRoomId: args.canonicalRoomId,
        onMerged: args.onMerged,
      },
      debounceMs,
    );
    return;
  }

  scheduleDebouncedPullSocialChatReadPointers(
    {
      roomId: rid,
      myAppUserId: me,
      ownerUserId: args.ownerUserId,
      peerUserId: args.peerUserId,
      onMerged: args.onMerged,
    },
    debounceMs,
  );
}

const postSendReadPullTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** 메시지 전송·서버 seq 확정 후 — 상대 읽음 맵 1회 동기화(주기 폴링 없음). */
export function schedulePostSendChatBubbleReadPointersPull(
  args: ChatBubbleReadPointersPullArgs,
  delayMs = 2000,
): void {
  const rid = String(args.roomId ?? '').trim();
  const me = String(args.myAppUserId ?? '').trim();
  if (!rid || !me) return;
  const delay = Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 2000;
  const key = `${args.roomKind}:${me}:${rid}`;
  const prev = postSendReadPullTimers.get(key);
  if (prev) clearTimeout(prev);
  postSendReadPullTimers.set(
    key,
    setTimeout(() => {
      postSendReadPullTimers.delete(key);
      scheduleChatBubbleReadPointersPull(args);
    }, delay),
  );
}

