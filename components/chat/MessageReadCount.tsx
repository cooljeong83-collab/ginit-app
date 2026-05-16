import { type RefObject, useMemo } from 'react';
import { Text } from 'react-native';

import { meetingChatBodyStyles as styles } from '@/components/chat/meeting-chat-body-styles';
import {
  computeDmUnreadCountForSentMessage,
  computeMeetingUnreadCountForSentMessage,
  pickPeerDmReadFromRoomSummary,
} from '@/src/lib/meeting-chat-bubble-unread';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import { useWmChatRoomReadMaps } from '@/src/hooks/use-wm-chat-room-read-maps';

/**
 * 내 말풍선 옆 "안 읽은 사람 수"만 담당합니다.
 * FlashList/extraData와 분리하기 위해 `chat_rooms` 읽음은 `observeWithColumns`(JSON 맵 컬럼)로만 구독합니다.
 */
export type MessageReadCountProps = {
  roomType: 'meeting' | 'social_dm';
  /** Watermelon `chat_rooms.room_id` 후보(라우트 id·문서 id 등). */
  wmChatRoomIds: readonly string[];
  messageId: string;
  messageCreatedAtMs: number;
  serverSeq?: number | null;
  chatRenderMode: 'meeting_group' | 'social_dm';
  myId: string;
  participantIds: readonly string[];
  peerId?: string;
  peerReadStateReady?: boolean;
  messageIndex: number;
  messageIndexByIdRef: RefObject<Map<string, number>>;
  /** pull·Realtime 병합 후 부모가 올려 주는 틱(observe 보조) */
  readMapsRevision?: number;
};

export function MessageReadCount({
  roomType,
  wmChatRoomIds,
  messageId,
  messageCreatedAtMs,
  serverSeq,
  chatRenderMode,
  myId,
  participantIds,
  peerId = '',
  peerReadStateReady = false,
  messageIndex,
  messageIndexByIdRef,
  readMapsRevision = 0,
}: MessageReadCountProps) {
  const wmReadMaps = useWmChatRoomReadMaps({ roomType, wmChatRoomIds, readMapsRevision });

  const unread = useMemo(() => {
    if (!messageCreatedAtMs) return 0;
    const messageStub = {
      id: messageId,
      createdAt: { toMillis: () => messageCreatedAtMs },
    } as MeetingChatMessage;
    const idxMap = messageIndexByIdRef.current ?? new Map<string, number>();
    const unreadIdx = idxMap.get(messageId) ?? messageIndex;

    if (chatRenderMode === 'social_dm') {
      const peer = peerId.trim();
      const wmPeer = peer ? pickPeerDmReadFromRoomSummary({ summary: wmReadMaps, peerId: peer }) : { readMessageId: null, readAtMs: 0 };
      return computeDmUnreadCountForSentMessage({
        message: messageStub,
        messageIndex: unreadIdx,
        messageIndexById: idxMap,
        peerReadMessageId: wmPeer.readMessageId,
        peerReadAtMs: wmPeer.readAtMs,
        peerReadLastSeq: wmPeer.readLastSeq,
        peerReadStateReady,
        messageServerSeq: serverSeq,
      });
    }

    return computeMeetingUnreadCountForSentMessage({
      message: messageStub,
      messageIndex: unreadIdx,
      messageIndexById: idxMap,
      participantIds,
      myId,
      readMessageIdByUser: wmReadMaps.messageReadMessageIdBy,
      readAtMsByUser: wmReadMaps.messageReadAtMsBy,
      readLastSeqByUser: wmReadMaps.messageReadLastSeqBy,
      messageServerSeq: serverSeq,
    });
  }, [
    messageId,
    messageCreatedAtMs,
    messageIndex,
    messageIndexByIdRef,
    chatRenderMode,
    myId,
    participantIds,
    peerId,
    peerReadStateReady,
    serverSeq,
    wmReadMaps,
    readMapsRevision,
  ]);

  if (unread <= 0) return null;
  return (
    <Text style={styles.unreadBubbleCount} accessibilityLabel={`안 읽은 사람 ${unread}명`}>
      {unread}
    </Text>
  );
}
