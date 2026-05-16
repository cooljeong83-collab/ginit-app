import { GinitPressable } from '@/components/ui/GinitPressable';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { Q } from '@nozbe/watermelondb';
import { withObservables } from '@nozbe/watermelondb/react';
import { memo, useCallback, useMemo, useState, type RefObject } from 'react';
import { Alert, Share, Text, View } from 'react-native';
import { of } from 'rxjs';

import { MeetingChatBubbleActionMenu } from '@/components/chat/MeetingChatBubbleActionMenu';
import type { MeetingChatBubbleActionMenuAction } from '@/components/chat/MeetingChatBubbleActionMenu';
import { MeetingChatGinitImageCluster } from '@/components/chat/MeetingChatGinitImageCluster';
import { MeetingChatLinkPreviewCard } from '@/components/chat/MeetingChatLinkPreviewCard';
import { meetingChatBodyStyles as styles } from '@/components/chat/meeting-chat-body-styles';
import {
  formatChatTime,
  profileForSender,
  replyPreviewText,
  replyTargetLabel,
} from '@/components/chat/meeting-chat-ui-helpers';
import { MeetingChatSwipeToReply } from '@/components/chat/meeting-chat-swipe-to-reply';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { LinkableChatText } from '@/components/ui/LinkableChatText';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { copyMeetingChatListRowToClipboard, copyTextForMeetingChatListRow } from '@/src/lib/meeting-chat-bubble-copy';
import { MessageReadCount } from '@/components/chat/MessageReadCount';
import { extractFirstHttpUrlFromChatText } from '@/src/lib/chat-text-linkify';
import { formatDateWithKoWeekday } from '@/src/lib/date-display';
import { meetingChatAlbumAnchorMessage, type MeetingChatListRow } from '@/src/lib/meeting-chat-list-rows';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import { wmChatMessageModelToMeetingMessage } from '@/src/lib/watermelon-chat-message-map';
import { WM_CHAT_MESSAGE_LIST_OBSERVE_COLUMNS } from '@/src/lib/watermelon-observe-columns';
import { database } from '@/src/watermelon';
import type { ChatMessage } from '@/src/watermelon/models/ChatMessage';
import type { UserProfile } from '@/src/lib/user-profile';
import { WITHDRAWN_NICKNAME, isUserProfileWithdrawn } from '@/src/lib/user-profile';

function rowIsSystemRow(row: MeetingChatListRow): boolean {
  return row.type === 'message' && row.message.kind === 'system';
}

function rowSenderNorm(row: MeetingChatListRow): string {
  if (row.type === 'message') {
    const s = row.message.senderId?.trim();
    return s ? normalizeParticipantId(s) : '';
  }
  const f = row.messages[0]?.senderId?.trim();
  return f ? normalizeParticipantId(f) : '';
}

function rowAnchorDate(row: MeetingChatListRow): Date | null {
  if (row.type === 'message') return row.message.createdAt?.toDate?.() ?? null;
  return meetingChatAlbumAnchorMessage(row).createdAt?.toDate?.() ?? null;
}

export type MeetingChatObservableMessageRowProps = {
  roomId: string;
  roomType: 'meeting' | 'social_dm';
  /** Watermelon `chat_rooms` 조회용 `room_id` 목록(중복 라우트/문서 id). */
  wmChatRoomIds: readonly string[];
  messageId: string;
  chatRenderMode: 'meeting_group' | 'social_dm';
  item: Extract<MeetingChatListRow, { type: 'message' }>;
  listRowsRef: RefObject<MeetingChatListRow[]>;
  messageIndexByIdRef: RefObject<Map<string, number>>;
  listRowIndex: number;
  myId: string;
  hostNorm: string;
  profilesRef: RefObject<Map<string, UserProfile>>;
  participantIdsForUnread: readonly string[];
  peerId?: string;
  peerReadStateReady?: boolean;
  readMapsRevision?: number;
  jumpToRepliedMessage: (replyMessageId: string) => void | Promise<void>;
  setReplyTo: (v: MeetingChatMessage['replyTo']) => void;
  deleteMessageBestEffort?: (msg: MeetingChatMessage) => void | Promise<void>;
  onOpenUserProfile: (id: string) => void;
  openMeetingChatImageViewer: (item: MeetingChatMessage) => void;
  listRef: RefObject<unknown>;
  messageSearchHighlightQuery?: string;
  chatBubbleMaxWidthStyle: { maxWidth: number };
};

type Observed = {
  wmMessages: ChatMessage[];
};

const MeetingChatBubbleRow = memo(function MeetingChatBubbleRow(props: MeetingChatObservableMessageRowProps & Observed) {
  const {
    item,
    roomType,
    listRowsRef,
    messageIndexByIdRef,
    listRowIndex,
    myId,
    hostNorm,
    profilesRef,
    chatRenderMode,
    wmChatRoomIds,
    participantIdsForUnread,
    peerId,
    peerReadStateReady,
    readMapsRevision = 0,
    jumpToRepliedMessage,
    setReplyTo,
    deleteMessageBestEffort,
    onOpenUserProfile,
    openMeetingChatImageViewer,
    listRef,
    messageSearchHighlightQuery,
    chatBubbleMaxWidthStyle,
    wmMessages,
  } = props;

  const [menu, setMenu] = useState<{ visible: boolean; x: number; y: number }>({ visible: false, x: 0, y: 0 });

  const closeMenu = useCallback(() => setMenu((p) => ({ ...p, visible: false })), []);

  const openMenuForRow = useCallback((e: any) => {
    const ne = e?.nativeEvent;
    const x = typeof ne?.pageX === 'number' ? ne.pageX : 12;
    const y = typeof ne?.pageY === 'number' ? ne.pageY : 12;
    setMenu({ visible: true, x, y });
  }, []);

  const anchorMsg = useMemo(() => {
    const wm0 = wmMessages[0];
    if (wm0) return wmChatMessageModelToMeetingMessage(wm0);
    return item.message;
  }, [wmMessages, item.message]);

  const messageCreatedAtMs = useMemo(() => {
    const ca = anchorMsg.createdAt;
    if (ca && typeof (ca as { toMillis?: () => number }).toMillis === 'function') {
      try {
        return (ca as { toMillis: () => number }).toMillis();
      } catch {
        return 0;
      }
    }
    return 0;
  }, [anchorMsg.createdAt]);

  const menuActions = useMemo(() => {
    const row = item;
    const itemForReply = anchorMsg;
    const sid = rowSenderNorm(row);
    const canDelete = Boolean(deleteMessageBestEffort && myId && sid && sid === myId && anchorMsg.kind !== 'system');
    return [
      {
        key: 'share' as const,
        label: '공유하기',
        onPress: async () => {
          const text = copyTextForMeetingChatListRow(row).trim();
          if (!text) return;
          await Share.share({ message: text });
        },
      },
      {
        key: 'reply' as const,
        label: '답장하기',
        onPress: () =>
          setReplyTo({
            messageId: itemForReply.id,
            senderId: itemForReply.senderId ?? null,
            kind: itemForReply.kind,
            imageUrl: itemForReply.imageUrl ?? null,
            text: itemForReply.text,
          }),
      },
      {
        key: 'copy' as const,
        label: '복사',
        onPress: () => copyMeetingChatListRowToClipboard(row),
      },
      ...(canDelete
        ? ([
            {
              key: 'delete' as const,
              label: '삭제',
              onPress: () => {
                Alert.alert('삭제', '이 메시지를 삭제할까요?', [
                  { text: '취소', style: 'cancel' },
                  {
                    text: '삭제',
                    style: 'destructive',
                    onPress: () => void deleteMessageBestEffort?.(anchorMsg),
                  },
                ]);
              },
            },
          ] as const)
        : []),
    ] satisfies MeetingChatBubbleActionMenuAction[];
  }, [item, anchorMsg, setReplyTo, deleteMessageBestEffort, myId]);

  const highlightQ = String(messageSearchHighlightQuery ?? '').trim();
  const bubbleText = (raw: string | null | undefined, textStyle: (typeof styles)['bubbleMineText']) => (
    <LinkableChatText
      text={String(raw ?? '')}
      highlightQuery={highlightQ}
      style={textStyle}
      highlightBackgroundColor="#4527A0"
      highlightTextColor="#FFFFFF"
    />
  );

  const listRows = listRowsRef.current ?? [];
  const index = listRowIndex;
  const next = index + 1 < listRows.length ? listRows[index + 1]! : null;
  const currDate = rowAnchorDate(item);
  const nextDate = next ? rowAnchorDate(next) : null;
  const dateLabel =
    currDate &&
    (!nextDate ||
      currDate.getFullYear() !== nextDate.getFullYear() ||
      currDate.getMonth() !== nextDate.getMonth() ||
      currDate.getDate() !== nextDate.getDate())
      ? formatDateWithKoWeekday(currDate)
      : '';

  const sid = rowSenderNorm(item);
  const isMine = Boolean(myId && sid && sid === myId);
  const nextSid = next ? rowSenderNorm(next) : '';
  const sameSenderAsNext = Boolean(sid && nextSid && nextSid === sid);
  const showAvatar = !isMine && sid && (index === 0 || !next || rowIsSystemRow(next) || !sameSenderAsNext);

  const profiles = profilesRef.current ?? new Map<string, UserProfile>();
  const profFromMap = sid ? profileForSender(profiles, sid) : undefined;
  const cachedSenderPhotoUrl = anchorMsg.senderAvatarUrl?.trim() || null;
  const cachedSenderName = anchorMsg.senderName?.trim() || null;
  const prof =
    !isUserProfileWithdrawn(profFromMap) && (cachedSenderPhotoUrl || cachedSenderName)
      ? ({
          ...(profFromMap ?? { nickname: cachedSenderName ?? '회원', photoUrl: cachedSenderPhotoUrl }),
          nickname: profFromMap?.nickname?.trim() || cachedSenderName || '회원',
          photoUrl: profFromMap?.photoUrl?.trim() || cachedSenderPhotoUrl,
        } satisfies UserProfile)
      : profFromMap;
  const withdrawn = isUserProfileWithdrawn(prof);
  const nick = withdrawn ? WITHDRAWN_NICKNAME : (prof?.nickname ?? '회원');
  const isHost = Boolean(hostNorm && sid && sid === hostNorm);
  const canOpenPeerProfile = Boolean(sid && !withdrawn && sid !== 'ginit_ai');

  const singleMsg = item.message;
  const isImage = singleMsg.kind === 'image';
  const hasServerAck =
    typeof singleMsg?.serverSeq === 'number' && Number.isFinite(singleMsg.serverSeq) && singleMsg.serverSeq > 0;
  const isOutboundPending =
    isMine &&
    Boolean(typeof singleMsg.id === 'string' && singleMsg.id.startsWith('local:')) &&
    !hasServerAck;
  const caption = singleMsg?.text?.trim();
  const isLinkOnlyText =
    Boolean(singleMsg.kind === 'text' && singleMsg.linkPreview?.url) &&
    (() => {
      const raw = (singleMsg?.text ?? '').trim();
      if (!raw) return false;
      const first = extractFirstHttpUrlFromChatText(raw);
      return Boolean(first && raw === first);
    })();

  const showKakaoPlain = isImage;

  const renderReply = (which: 'mine' | 'other') => {
    if (!anchorMsg.replyTo?.messageId) return null;
    const box = which === 'mine' ? styles.replyQuoteMine : styles.replyQuoteOther;
    const lab = which === 'mine' ? styles.replyQuoteLabelMine : styles.replyQuoteLabelOther;
    const txt = which === 'mine' ? styles.replyQuoteTextMine : styles.replyQuoteTextOther;
    return (
      <View style={box}>
        <GinitPressable
          onPress={() => void jumpToRepliedMessage(anchorMsg.replyTo?.messageId ?? '')}
          style={({ pressed }) => [styles.replyQuotePressable, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="원글로 이동">
          <View style={styles.replyQuoteTopRow}>
            <View style={styles.replyQuoteTextCol}>
              <Text style={lab}>{replyTargetLabel(anchorMsg.replyTo, profiles)}에게 답장</Text>
              <Text style={txt} numberOfLines={2}>
                {replyPreviewText(anchorMsg.replyTo)}
              </Text>
            </View>
            {anchorMsg.replyTo.kind === 'image' && anchorMsg.replyTo.imageUrl?.trim() ? (
              <Image
                source={{ uri: anchorMsg.replyTo.imageUrl.trim() }}
                style={styles.replyQuoteThumb}
                contentFit="cover"
                cachePolicy="disk"
                recyclingKey={
                  anchorMsg.replyTo.messageId
                    ? `${anchorMsg.replyTo.messageId}:${anchorMsg.replyTo.imageUrl.trim()}`
                    : anchorMsg.replyTo.imageUrl.trim()
                }
              />
            ) : null}
          </View>
        </GinitPressable>
      </View>
    );
  };

  if (isMine) {
    const timeSource = anchorMsg.createdAt;
    const imageClusterMine =
      isImage && singleMsg?.imageUrl ? (
        <MeetingChatGinitImageCluster messages={[singleMsg]} onPressImage={openMeetingChatImageViewer} alignEnd />
      ) : isImage ? (
        <Text style={styles.bubbleMineText}>이미지를 불러올 수 없어요.</Text>
      ) : null;
    const bubbleMainMine = showKakaoPlain ? (
      <GinitPressable
        onLongPress={openMenuForRow}
        delayLongPress={420}
        accessibilityLabel="말풍선 옵션"
        style={({ pressed }) => [
          [styles.bubbleMineWrap, styles.ginitPlainMineWrap, chatBubbleMaxWidthStyle],
          pressed && styles.pressed,
        ]}>
        {renderReply('mine')}
        {anchorMsg.replyTo?.messageId ? <View style={styles.replyDivider} /> : null}
        {imageClusterMine}
        {isImage && caption ? bubbleText(caption ?? '', styles.imageCaptionMine) : null}
      </GinitPressable>
    ) : isLinkOnlyText && singleMsg?.linkPreview ? (
      <GinitPressable
        onLongPress={openMenuForRow}
        delayLongPress={420}
        accessibilityLabel="말풍선 옵션"
        style={({ pressed }) => [
          [styles.bubbleMineWrap, styles.ginitPlainMineWrap, chatBubbleMaxWidthStyle],
          pressed && styles.pressed,
        ]}>
        <MeetingChatLinkPreviewCard preview={singleMsg.linkPreview} mine rawUrlText={singleMsg.text} standalone />
      </GinitPressable>
    ) : (
      <GinitPressable
        onLongPress={openMenuForRow}
        delayLongPress={420}
        accessibilityLabel="말풍선 옵션"
        style={({ pressed }) => [styles.bubbleMineWrap, chatBubbleMaxWidthStyle, pressed && styles.pressed]}>
        <BlurView tint="light" intensity={60} style={styles.bubbleMine}>
          {renderReply('mine')}
          {anchorMsg.replyTo?.messageId ? <View style={styles.replyDivider} /> : null}
          {bubbleText(singleMsg?.text, styles.bubbleMineText)}
          {singleMsg?.linkPreview?.url && singleMsg.linkPreview ? (
            <MeetingChatLinkPreviewCard
              preview={singleMsg.linkPreview}
              mine
              rawUrlText={extractFirstHttpUrlFromChatText(singleMsg?.text ?? '') ?? ''}
            />
          ) : null}
        </BlurView>
      </GinitPressable>
    );
    const bubble = (
      <View style={styles.rowMine}>
        <View style={styles.timeMineCol}>
          <MessageReadCount
            roomType={roomType}
            wmChatRoomIds={wmChatRoomIds}
            messageId={anchorMsg.id}
            messageCreatedAtMs={messageCreatedAtMs}
            serverSeq={singleMsg?.serverSeq ?? null}
            chatRenderMode={chatRenderMode}
            myId={myId}
            participantIds={participantIdsForUnread}
            peerId={peerId}
            peerReadStateReady={peerReadStateReady}
            readMapsRevision={readMapsRevision}
            messageIndex={messageIndexByIdRef.current.get(anchorMsg.id) ?? listRowIndex}
            messageIndexByIdRef={messageIndexByIdRef}
          />
          <Text style={styles.timeMine}>{formatChatTime(timeSource)}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
          <View style={isOutboundPending ? { opacity: 0.86 } : undefined}>{bubbleMainMine}</View>
        </View>
      </View>
    );
    return (
      <View style={styles.listRowRoot}>
        <MeetingChatBubbleActionMenu
          visible={menu.visible}
          anchor={menu.visible ? { x: menu.x, y: menu.y } : null}
          onRequestClose={closeMenu}
          actions={menuActions}
        />
        {dateLabel ? (
          <View style={styles.dateChipRow}>
            <View style={styles.dateChip}>
              <Text style={styles.dateChipText}>{dateLabel}</Text>
            </View>
          </View>
        ) : null}
        <MeetingChatSwipeToReply
          simultaneousHandlers={listRef}
          onTriggerReply={() =>
            setReplyTo({
              messageId: anchorMsg.id,
              senderId: anchorMsg.senderId ?? null,
              kind: anchorMsg.kind,
              imageUrl: anchorMsg.imageUrl ?? null,
              text: anchorMsg.text,
            })
          }>
          {bubble}
        </MeetingChatSwipeToReply>
      </View>
    );
  }

  const imageClusterOther =
    isImage && singleMsg?.imageUrl ? (
      <MeetingChatGinitImageCluster messages={[singleMsg]} onPressImage={openMeetingChatImageViewer} />
    ) : isImage ? (
      <Text style={styles.bubbleOtherText}>이미지를 불러올 수 없어요.</Text>
    ) : null;

  const otherBubble = (
    <View style={styles.rowOther}>
      <GinitPressable
        style={styles.avatarCol}
        disabled={!canOpenPeerProfile}
        onPress={() => canOpenPeerProfile && onOpenUserProfile(sid)}
        accessibilityRole={canOpenPeerProfile ? 'button' : undefined}
        accessibilityLabel={canOpenPeerProfile ? '프로필 보기' : undefined}>
        {showAvatar ? (
          withdrawn ? (
            <View style={styles.avatarWithdrawn}>
              <GinitSymbolicIcon name="person" size={18} color="#94a3b8" />
            </View>
          ) : prof?.photoUrl ? (
            <Image
              source={{ uri: prof.photoUrl }}
              style={styles.avatar}
              contentFit="cover"
              cachePolicy="disk"
              recyclingKey={prof.photoUrl}
            />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarFallbackText}>{nick.slice(0, 1)}</Text>
            </View>
          )
        ) : (
          <View style={styles.avatarSpacer} />
        )}
      </GinitPressable>
      <View style={styles.otherBlock} pointerEvents="box-none">
        {showAvatar ? (
          <GinitPressable
            disabled={!canOpenPeerProfile}
            onPress={() => canOpenPeerProfile && onOpenUserProfile(sid)}
            style={({ pressed }) => [styles.nameRow, canOpenPeerProfile && pressed && styles.pressed]}
            accessibilityRole={canOpenPeerProfile ? 'button' : undefined}
            accessibilityLabel={canOpenPeerProfile ? '프로필 보기' : undefined}>
            <Text style={styles.nickname} numberOfLines={1}>
              {nick}
            </Text>
            {isHost ? <GinitSymbolicIcon name="star" size={14} color="#CA8A04" style={styles.crown} /> : null}
          </GinitPressable>
        ) : null}
        <View style={styles.bubbleOtherWrap}>
          {showKakaoPlain ? (
            <GinitPressable
              onLongPress={openMenuForRow}
              delayLongPress={420}
              accessibilityLabel="말풍선 옵션"
              style={({ pressed }) => [
                [styles.bubbleOtherOuter, styles.ginitPlainOtherOuter, chatBubbleMaxWidthStyle],
                pressed && styles.pressed,
              ]}>
              {renderReply('other')}
              {anchorMsg.replyTo?.messageId ? <View style={styles.replyDivider} /> : null}
              {imageClusterOther}
              {isImage && caption ? bubbleText(caption ?? '', styles.imageCaptionOther) : null}
              {sid === 'ginit_ai' ? <View style={styles.aiNeonOutline} pointerEvents="none" /> : null}
            </GinitPressable>
          ) : isLinkOnlyText && singleMsg?.linkPreview ? (
            <GinitPressable
              onLongPress={openMenuForRow}
              delayLongPress={420}
              accessibilityLabel="말풍선 옵션"
              style={({ pressed }) => [styles.bubbleOtherOuter, chatBubbleMaxWidthStyle, pressed && styles.pressed]}>
              <MeetingChatLinkPreviewCard preview={singleMsg.linkPreview} mine={false} rawUrlText={singleMsg.text} standalone />
            </GinitPressable>
          ) : (
            <View style={[styles.bubbleOtherOuter, chatBubbleMaxWidthStyle]}>
              <GinitPressable
                onLongPress={openMenuForRow}
                delayLongPress={420}
                accessibilityLabel="말풍선 옵션"
                style={({ pressed }) => [pressed && styles.pressed]}>
                <BlurView tint="light" intensity={60} style={styles.bubbleOther}>
                  {renderReply('other')}
                  {anchorMsg.replyTo?.messageId ? <View style={styles.replyDivider} /> : null}
                  {bubbleText(singleMsg?.text, styles.bubbleOtherText)}
                  {singleMsg?.linkPreview?.url && singleMsg.linkPreview ? (
                    <MeetingChatLinkPreviewCard
                      preview={singleMsg.linkPreview}
                      mine={false}
                      rawUrlText={extractFirstHttpUrlFromChatText(singleMsg?.text ?? '') ?? ''}
                    />
                  ) : null}
                </BlurView>
                {sid === 'ginit_ai' ? <View style={styles.aiNeonOutline} pointerEvents="none" /> : null}
              </GinitPressable>
            </View>
          )}
          <Text style={styles.timeOther}>{formatChatTime(anchorMsg.createdAt)}</Text>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.listRowRoot}>
      <MeetingChatBubbleActionMenu
        visible={menu.visible}
        anchor={menu.visible ? { x: menu.x, y: menu.y } : null}
        onRequestClose={closeMenu}
        actions={menuActions}
      />
      {dateLabel ? (
        <View style={styles.dateChipRow}>
          <View style={styles.dateChip}>
            <Text style={styles.dateChipText}>{dateLabel}</Text>
          </View>
        </View>
      ) : null}
      <MeetingChatSwipeToReply
        simultaneousHandlers={listRef}
        onTriggerReply={() =>
          setReplyTo({
            messageId: anchorMsg.id,
            senderId: anchorMsg.senderId ?? null,
            kind: anchorMsg.kind,
            imageUrl: anchorMsg.imageUrl ?? null,
            text: anchorMsg.text,
          })
        }>
        {otherBubble}
      </MeetingChatSwipeToReply>
    </View>
  );
});

const enhance = withObservables(
  ['roomId', 'roomType', 'messageId'],
  ({ roomId, roomType, messageId }: Pick<MeetingChatObservableMessageRowProps, 'roomId' | 'roomType' | 'messageId'>) => {
    const db = database;
    if (!db) {
      return {
        wmMessages: of([] as ChatMessage[]),
      };
    }
    const msgs = db.get('chat_messages');
    return {
      wmMessages: msgs
        .query(Q.where('room_id', roomId), Q.where('room_type', roomType), Q.where('message_id', messageId))
        .observeWithColumns([...WM_CHAT_MESSAGE_LIST_OBSERVE_COLUMNS]),
    };
  },
);

export const MeetingChatObservableMessageRow = enhance(MeetingChatBubbleRow as any);
export { MeetingChatBubbleRow };
