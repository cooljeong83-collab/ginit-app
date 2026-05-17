import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef } from 'react';

import { useChatMarkReadMutation } from '@/src/hooks/use-chat-mark-read-mutation';
import { buildChatMarkReadInputFromLocalRoom, markChatRoomReadLocally, type ChatMarkReadInput } from '@/src/lib/chat-mark-read';
import type { ChatRoomKindDelta } from '@/src/lib/chat-supabase-delta';

export type ChatMarkReadLatestMessage = {
  id: string;
  serverSeq?: number | null;
  createdAtMs?: number;
};

export type UseChatMarkReadOnFocusArgs = {
  roomKind: ChatRoomKindDelta;
  roomId: string;
  meAppUserId: string;
  ownerUserId?: string | null;
  peerUserId?: string | null;
  isFocused: boolean;
  enabled: boolean;
  /** 모임: inverted 리스트 [0]=최신. 소셜: [length-1]=최신 */
  pickLatest: (messages: readonly ChatMarkReadLatestMessage[]) => ChatMarkReadLatestMessage | null;
  messages: readonly ChatMarkReadLatestMessage[];
  /** InAppAlarms 모임 채팅 읽음 포인터(선택) */
  markChatReadUpTo?: (roomId: string, messageId: string | undefined) => void;
  /** blur 시에도 읽음 처리할지(모임 채팅 기존 동작 유지) */
  markOnBlur?: boolean;
};

/**
 * 채팅방 포커스·최신 메시지 변경 시 읽음 처리(로컬 Watermelon 1회 + TanStack mutation은 서버만).
 */
export function useChatMarkReadOnFocus(args: UseChatMarkReadOnFocusArgs): void {
  const {
    roomKind,
    roomId,
    meAppUserId,
    ownerUserId,
    peerUserId,
    isFocused,
    enabled,
    pickLatest,
    messages,
    markChatReadUpTo,
    markOnBlur = false,
  } = args;

  const markRead = useChatMarkReadMutation();
  const lastMarkedIdRef = useRef('');
  /** 동일 방에서 이미 처리한 최대 server_seq — tail 재정렬로 id가 바뀌어도 역행·중복 방지 */
  const lastMarkedSeqRef = useRef(0);
  const prevEnabledRef = useRef(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const runMarkRead = useCallback(
    (latest: ChatMarkReadLatestMessage) => {
      const rid = roomId.trim();
      const me = meAppUserId.trim();
      const lid = latest.id?.trim() ?? '';
      if (!rid || !me || !lid || lid.startsWith('local:')) return;

      const lastReadSeq =
        typeof latest.serverSeq === 'number' && Number.isFinite(latest.serverSeq) && latest.serverSeq > 0
          ? Math.floor(latest.serverSeq)
          : null;

      if (lastReadSeq != null && lastReadSeq > 0) {
        /** tail id만 바뀌고(낙관적→서버 id) seq는 같을 때 중복 읽음·RPC 방지 */
        if (lastReadSeq <= lastMarkedSeqRef.current) {
          return;
        }
      } else if (lastMarkedIdRef.current === lid) {
        return;
      }

      /** async 전에 예약 — `markChatRoomReadLocally`→messages effect 재진입 시 markChatReadUpTo 폭주 방지 */
      lastMarkedIdRef.current = lid;
      if (lastReadSeq != null && lastReadSeq > 0) {
        lastMarkedSeqRef.current = lastReadSeq;
      }

      markChatReadUpTo?.(rid, lid);

      const input: ChatMarkReadInput = {
        roomKind,
        roomId: rid,
        meAppUserId: me,
        ownerUserId: ownerUserId?.trim() ?? me,
        peerUserId: peerUserId?.trim() ?? null,
        readMessageId: lid,
        readAtMs: Date.now(),
        lastReadSeq,
      };

      void (async () => {
        await markChatRoomReadLocally(input);
        if (!enabled) return;
        markRead.mutate(input);
      })();
    },
    [roomKind, roomId, meAppUserId, ownerUserId, peerUserId, markChatReadUpTo, markRead, enabled],
  );

  useEffect(() => {
    lastMarkedIdRef.current = '';
    lastMarkedSeqRef.current = 0;
    prevEnabledRef.current = false;
  }, [roomId]);

  /** 방 진입 직후: `chat_rooms` 요약만으로 읽음(메시지 리스트 대기 없음). */
  const flushEnterReadFromRoomSummary = useCallback(async () => {
    if (!isFocused || !enabled) return;
    const rid = roomId.trim();
    const me = meAppUserId.trim();
    if (!rid || !me) return;
    const input = await buildChatMarkReadInputFromLocalRoom({
      roomKind,
      roomId: rid,
      meAppUserId: me,
      ownerUserId: ownerUserId?.trim() ?? me,
      peerUserId: peerUserId?.trim() ?? null,
    });
    if (!input) return;
    runMarkRead({
      id: input.readMessageId,
      serverSeq: input.lastReadSeq ?? undefined,
      createdAtMs: input.readAtMs,
    });
  }, [isFocused, enabled, roomKind, roomId, meAppUserId, ownerUserId, peerUserId, runMarkRead]);

  useFocusEffect(
    useCallback(() => {
      void flushEnterReadFromRoomSummary();
      return () => {};
    }, [flushEnterReadFromRoomSummary]),
  );

  /** `ready` 직후: enabled=false 때 서버 RPC만 스킵됐을 수 있어 ref 리셋 후 요약 읽음 재시도 */
  useEffect(() => {
    const wasEnabled = prevEnabledRef.current;
    prevEnabledRef.current = enabled;
    if (!enabled || !isFocused) return;
    if (!wasEnabled) {
      lastMarkedIdRef.current = '';
      lastMarkedSeqRef.current = 0;
      void flushEnterReadFromRoomSummary();
    }
  }, [enabled, isFocused, flushEnterReadFromRoomSummary]);

  /** tail 로드·새 메시지 시 요약보다 최신이면 한 번 더 읽음 처리 */
  useEffect(() => {
    if (!enabled || !isFocused) return;
    const latest = pickLatest(messages);
    if (!latest?.id) return;
    runMarkRead(latest);
  }, [enabled, isFocused, messages, pickLatest, runMarkRead]);

  useFocusEffect(
    useCallback(() => {
      if (!markOnBlur || !enabled) {
        return () => {};
      }
      return () => {
        const latest = pickLatest(messagesRef.current);
        if (latest?.id) runMarkRead(latest);
      };
    }, [markOnBlur, enabled, pickLatest, runMarkRead]),
  );
}
