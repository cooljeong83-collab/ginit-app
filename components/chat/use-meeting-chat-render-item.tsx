import { GinitPressable } from '@/components/ui/GinitPressable';

import {BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { type RefObject, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Share, Text, View, useWindowDimensions } from 'react-native';

import { MeetingChatGinitImageCluster } from '@/components/chat/MeetingChatGinitImageCluster';
import { MeetingChatBubbleActionMenu } from '@/components/chat/MeetingChatBubbleActionMenu';
import type { MeetingChatBubbleActionMenuAction } from '@/components/chat/MeetingChatBubbleActionMenu';
import { MeetingChatLinkPreviewCard } from '@/components/chat/MeetingChatLinkPreviewCard';
import { MessageReadCount } from '@/components/chat/MessageReadCount';
import { meetingChatBodyStyles as styles } from '@/components/chat/meeting-chat-body-styles';
import { MeetingChatObservableMessageRow } from '@/components/chat/MeetingChatObservableMessageRow';
import { MeetingChatSwipeToReply } from '@/components/chat/meeting-chat-swipe-to-reply';
import {
  formatChatTime,
  profileForSender,
  replyPreviewText,
  replyTargetLabel,
} from '@/components/chat/meeting-chat-ui-helpers';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { extractFirstHttpUrlFromChatText } from '@/src/lib/chat-text-linkify';
import {
  meetingChatAlbumAnchorMessage,
  meetingChatDateChipLabelAtIndex,
  meetingChatShowPeerAvatarAtIndex,
  type MeetingChatListRow,
} from '@/src/lib/meeting-chat-list-rows';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import { copyMeetingChatListRowToClipboard, copyTextForMeetingChatListRow } from '@/src/lib/meeting-chat-bubble-copy';
import type { UserProfile } from '@/src/lib/user-profile';
import { WITHDRAWN_NICKNAME, isUserProfileWithdrawn } from '@/src/lib/user-profile';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { LinkableChatText } from '@/components/ui/LinkableChatText';

function rowSenderNorm(row: MeetingChatListRow): string {
  if (row.type === 'message') {
    const s = row.message.senderId?.trim();
    return s ? normalizeParticipantId(s) : '';
  }
  const f = row.messages[0]?.senderId?.trim();
  return f ? normalizeParticipantId(f) : '';
}

function flatUnreadIndex(messageIndexById: Map<string, number>, album: MeetingChatMessage[]): number {
  let min = Infinity;
  for (const m of album) {
    const ix = messageIndexById.get(m.id);
    if (ix != null && ix < min) min = ix;
  }
  return min === Infinity ? 0 : min;
}

export type MeetingChatRenderItemDeps = {
  listRows: MeetingChatListRow[];
  messageIndexById: Map<string, number>;
  myId: string;
  hostNorm: string;
  profiles: Map<string, UserProfile>;
  jumpToRepliedMessage: (replyMessageId: string) => void | Promise<void>;
  setReplyTo: (v: MeetingChatMessage['replyTo']) => void;
  /** 소프트 삭제(best-effort). meeting/social 컨텍스트에 맞게 호출부에서 주입 */
  deleteMessageBestEffort?: (msg: MeetingChatMessage) => void | Promise<void>;
  onOpenUserProfile: (id: string) => void;
  openMeetingChatImageViewer: (item: MeetingChatMessage) => void;
  listRef: RefObject<unknown>;
  /** 검색 확정어: 텍스트 말풍선(및 이미지 캡션) 내 일치 구간 하이라이트 */
  messageSearchHighlightQuery?: string;
  roomId?: string;
  roomType?: 'meeting' | 'social_dm';
  chatRenderMode?: 'meeting_group' | 'social_dm';
  /** Watermelon `chat_rooms.room_id` 후보 — 읽음 숫자용(말풍선 내부 구독). */
  wmChatRoomIds?: readonly string[];
  participantIdsForUnread?: readonly string[];
  peerId?: string;
  peerReadStateReady?: boolean;
  readMapsRevision?: number;
};

export function useMeetingChatRenderItem({
  listRows,
  messageIndexById,
  myId,
  hostNorm,
  profiles,
  jumpToRepliedMessage,
  setReplyTo,
  deleteMessageBestEffort,
  onOpenUserProfile,
  openMeetingChatImageViewer,
  listRef,
  messageSearchHighlightQuery = '',
  roomId = '',
  roomType,
  chatRenderMode = 'meeting_group',
  wmChatRoomIds = [],
  participantIdsForUnread = [],
  peerId = '',
  peerReadStateReady = false,
  readMapsRevision = 0,
}: MeetingChatRenderItemDeps) {
  const listRowsRef = useRef(listRows);
  const messageIndexByIdRef = useRef(messageIndexById);
  const profilesRef = useRef(profiles);
  useLayoutEffect(() => {
    listRowsRef.current = listRows;
    messageIndexByIdRef.current = messageIndexById;
    profilesRef.current = profiles;
  }, [listRows, messageIndexById, profiles]);
  const [menu, setMenu] = useState<{ visible: boolean; x: number; y: number; row: MeetingChatListRow | null }>({
    visible: false,
    x: 0,
    y: 0,
    row: null,
  });

  const closeMenu = useCallback(() => setMenu((p) => ({ ...p, visible: false })), []);

  const openMenuForRow = useCallback(
    (row: MeetingChatListRow, e: any) => {
      const ne = e?.nativeEvent;
      const x = typeof ne?.pageX === 'number' ? ne.pageX : 12;
      const y = typeof ne?.pageY === 'number' ? ne.pageY : 12;
      setMenu({ visible: true, x, y, row });
    },
    [],
  );

  const menuActions = useMemo(() => {
    const row = menu.row;
    if (!row) return [];
    const anchorMsg =
      row.type === 'message' ? row.message : meetingChatAlbumAnchorMessage(row);
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
  }, [menu.row, setReplyTo, deleteMessageBestEffort, myId]);

  const { width: windowWidth } = useWindowDimensions();
  /** FlashList 행에서 `maxWidth: '78%'` 기준이 무너져 한 글자 줄바꿈·클립이 나는 경우 방지 */
  const chatBubbleMaxWidthStyle = useMemo(() => {
    const inner = Math.max(0, windowWidth - 24); // listContent paddingHorizontal 12×2
    return { maxWidth: Math.max(120, Math.floor(inner * 0.78)) };
  }, [windowWidth]);

  const wmIdsForRead = useMemo(() => {
    const trimmed = [...wmChatRoomIds].map((x) => String(x ?? '').trim()).filter(Boolean);
    if (trimmed.length > 0) return [...new Set(trimmed)] as readonly string[];
    const r = roomId.trim();
    return r ? ([r] as const) : ([] as const);
  }, [wmChatRoomIds, roomId]);

  return useCallback(
    ({ item, index }: { item: MeetingChatListRow; index: number }) => {
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
      const rowsNow = listRowsRef.current ?? [];
      const rowAt = rowsNow[index] ?? item;
      const dateLabel = meetingChatDateChipLabelAtIndex(rowsNow, index);

      if (item.type === 'message' && item.message.kind === 'system') {
        const sys = item.message;
        return (
          <View style={styles.listRowRoot}>
            {dateLabel ? (
              <View style={styles.dateChipRow}>
                <View style={styles.dateChip}>
                  <Text style={styles.dateChipText}>{dateLabel}</Text>
                </View>
              </View>
            ) : null}
            <View style={styles.systemRow}>
              <LinkableChatText text={sys.text} style={styles.systemText} />
            </View>
          </View>
        );
      }

      if (item.type === 'message' && item.message.kind !== 'system' && roomId.trim() && roomType) {
        return (
          <MeetingChatObservableMessageRow
            roomId={roomId.trim()}
            roomType={roomType}
            wmChatRoomIds={wmIdsForRead}
            messageId={item.message.id}
            chatRenderMode={chatRenderMode}
            item={item}
            listRowsRef={listRowsRef}
            messageIndexByIdRef={messageIndexByIdRef}
            listRowIndex={index}
            myId={myId}
            hostNorm={hostNorm}
            profilesRef={profilesRef}
            participantIdsForUnread={participantIdsForUnread}
            peerId={peerId}
            peerReadStateReady={peerReadStateReady}
            readMapsRevision={readMapsRevision}
            jumpToRepliedMessage={jumpToRepliedMessage}
            setReplyTo={setReplyTo}
            deleteMessageBestEffort={deleteMessageBestEffort}
            onOpenUserProfile={onOpenUserProfile}
            openMeetingChatImageViewer={openMeetingChatImageViewer}
            listRef={listRef}
            messageSearchHighlightQuery={messageSearchHighlightQuery}
            chatBubbleMaxWidthStyle={chatBubbleMaxWidthStyle}
          />
        );
      }

      const isAlbum = rowAt.type === 'imageAlbum';
      const anchorMsg: MeetingChatMessage = isAlbum
        ? meetingChatAlbumAnchorMessage(rowAt)
        : (rowAt as Extract<MeetingChatListRow, { type: 'message' }>).message;
      const itemForReply: MeetingChatMessage = isAlbum
        ? meetingChatAlbumAnchorMessage(rowAt)
        : (rowAt as { type: 'message'; message: MeetingChatMessage }).message;

      const sid = rowSenderNorm(rowAt);
      const isMine = Boolean(myId && sid && sid === myId);
      const showAvatar = meetingChatShowPeerAvatarAtIndex(rowsNow, index, myId);

      const profFromMap = sid ? profileForSender(profilesRef.current, sid) : undefined;
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

      const singleMsg = rowAt.type === 'message' ? rowAt.message : null;
      const isImage = Boolean(singleMsg && singleMsg.kind === 'image');
      const hasServerAck =
        typeof singleMsg?.serverSeq === 'number' && Number.isFinite(singleMsg.serverSeq) && singleMsg.serverSeq > 0;
      const isOutboundPending =
        isMine &&
        !isAlbum &&
        Boolean(singleMsg && typeof singleMsg.id === 'string' && singleMsg.id.startsWith('local:')) &&
        !hasServerAck;
      const caption = singleMsg?.text?.trim();
      const isLinkOnlyText =
        Boolean(singleMsg && singleMsg.kind === 'text' && singleMsg.linkPreview?.url) &&
        (() => {
          const raw = (singleMsg?.text ?? '').trim();
          if (!raw) return false;
          const first = extractFirstHttpUrlFromChatText(raw);
          return Boolean(first && raw === first);
        })();

      const albumChrono = isAlbum ? item.messages : [];
      const albumCaption = isAlbum ? albumChrono[albumChrono.length - 1]?.text?.trim() : '';

      const showKakaoPlain = isAlbum || isImage;

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
                  <Text style={lab}>{replyTargetLabel(anchorMsg.replyTo, profilesRef.current)}에게 답장</Text>
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
        const unreadIdx = isAlbum
          ? flatUnreadIndex(messageIndexByIdRef.current, item.messages)
          : singleMsg
            ? (messageIndexByIdRef.current.get(singleMsg.id) ?? index)
            : index;
        const unreadMsg = isAlbum ? meetingChatAlbumAnchorMessage(item) : singleMsg!;
        const unreadCreatedMs =
          unreadMsg.createdAt && typeof unreadMsg.createdAt.toMillis === 'function' ? unreadMsg.createdAt.toMillis() : 0;
        const timeSource = anchorMsg.createdAt;
        const imageClusterMine = isAlbum ? (
          <MeetingChatGinitImageCluster messages={albumChrono} onPressImage={openMeetingChatImageViewer} alignEnd />
        ) : isImage && singleMsg?.imageUrl ? (
          <MeetingChatGinitImageCluster messages={[singleMsg]} onPressImage={openMeetingChatImageViewer} alignEnd />
        ) : isImage ? (
          <Text style={styles.bubbleMineText}>이미지를 불러올 수 없어요.</Text>
        ) : null;
        const bubbleMainMine = showKakaoPlain ? (
          <GinitPressable
            onLongPress={(e) => openMenuForRow(item, e)}
            delayLongPress={420}
            accessibilityLabel="말풍선 옵션"
            style={({ pressed }) => [
              [styles.bubbleMineWrap, styles.ginitPlainMineWrap, chatBubbleMaxWidthStyle],
              pressed && styles.pressed,
            ]}>
            {renderReply('mine')}
            {anchorMsg.replyTo?.messageId ? <View style={styles.replyDivider} /> : null}
            {imageClusterMine}
            {(isImage && caption) || (isAlbum && albumCaption) ? (
              bubbleText(isAlbum ? albumCaption : caption ?? '', styles.imageCaptionMine)
            ) : null}
          </GinitPressable>
        ) : isLinkOnlyText && singleMsg?.linkPreview ? (
          <GinitPressable
            onLongPress={(e) => openMenuForRow(item, e)}
            delayLongPress={420}
            accessibilityLabel="말풍선 옵션"
            style={({ pressed }) => [
              [styles.bubbleMineWrap, styles.ginitPlainMineWrap, chatBubbleMaxWidthStyle],
              pressed && styles.pressed,
            ]}>
            <MeetingChatLinkPreviewCard
              preview={singleMsg.linkPreview}
              mine
              layoutWidth={chatBubbleMaxWidthStyle.maxWidth}
              rawUrlText={singleMsg.text}
              standalone
            />
          </GinitPressable>
        ) : (
          <GinitPressable
            onLongPress={(e) => openMenuForRow(item, e)}
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
                  layoutWidth={chatBubbleMaxWidthStyle.maxWidth}
                  rawUrlText={extractFirstHttpUrlFromChatText(singleMsg?.text ?? '') ?? ''}
                />
              ) : null}
            </BlurView>
          </GinitPressable>
        );
        const bubble = (
          <View style={styles.rowMine}>
            <View style={styles.timeMineCol}>
              {roomId.trim() && roomType && wmIdsForRead.length > 0 ? (
                <MessageReadCount
                  roomType={roomType}
                  wmChatRoomIds={wmIdsForRead}
                  messageId={unreadMsg.id}
                  messageCreatedAtMs={unreadCreatedMs}
                  serverSeq={unreadMsg.serverSeq ?? null}
                  chatRenderMode={chatRenderMode}
                  myId={myId}
                  participantIds={participantIdsForUnread}
                  peerId={peerId}
                  peerReadStateReady={peerReadStateReady}
                  readMapsRevision={readMapsRevision}
                  messageIndex={unreadIdx}
                  messageIndexByIdRef={messageIndexByIdRef}
                />
              ) : null}
              <Text style={styles.timeMine}>{formatChatTime(timeSource)}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
              <View style={isOutboundPending ? { opacity: 0.86 } : undefined}>{bubbleMainMine}</View>
            </View>
          </View>
        );
        return (
          <View style={styles.listRowRoot}>
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
                  messageId: itemForReply.id,
                  senderId: itemForReply.senderId ?? null,
                  kind: itemForReply.kind,
                  imageUrl: itemForReply.imageUrl ?? null,
                  text: itemForReply.text,
                })
              }>
              {bubble}
            </MeetingChatSwipeToReply>
          </View>
        );
      }

      const imageClusterOther = isAlbum ? (
        <MeetingChatGinitImageCluster messages={albumChrono} onPressImage={openMeetingChatImageViewer} />
      ) : isImage && singleMsg?.imageUrl ? (
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
                  onLongPress={(e) => openMenuForRow(item, e)}
                  delayLongPress={420}
                  accessibilityLabel="말풍선 옵션"
                  style={({ pressed }) => [
                    [styles.bubbleOtherOuter, styles.ginitPlainOtherOuter, chatBubbleMaxWidthStyle],
                    pressed && styles.pressed,
                  ]}>
                  {renderReply('other')}
                  {anchorMsg.replyTo?.messageId ? <View style={styles.replyDivider} /> : null}
                  {imageClusterOther}
                  {(isImage && caption) || (isAlbum && albumCaption) ? (
                    bubbleText(isAlbum ? albumCaption : caption ?? '', styles.imageCaptionOther)
                  ) : null}
                  {sid === 'ginit_ai' ? <View style={styles.aiNeonOutline} pointerEvents="none" /> : null}
                </GinitPressable>
              ) : isLinkOnlyText && singleMsg?.linkPreview ? (
                <GinitPressable
                  onLongPress={(e) => openMenuForRow(item, e)}
                  delayLongPress={420}
                  accessibilityLabel="말풍선 옵션"
                  style={({ pressed }) => [styles.bubbleOtherOuter, chatBubbleMaxWidthStyle, pressed && styles.pressed]}>
                  <MeetingChatLinkPreviewCard
                    preview={singleMsg.linkPreview}
                    mine={false}
                    layoutWidth={chatBubbleMaxWidthStyle.maxWidth}
                    rawUrlText={singleMsg.text}
                    standalone
                  />
                </GinitPressable>
              ) : (
                <View style={[styles.bubbleOtherOuter, chatBubbleMaxWidthStyle]}>
                  <GinitPressable
                    onLongPress={(e) => openMenuForRow(item, e)}
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
                          layoutWidth={chatBubbleMaxWidthStyle.maxWidth}
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
                messageId: itemForReply.id,
                senderId: itemForReply.senderId ?? null,
                kind: itemForReply.kind,
                imageUrl: itemForReply.imageUrl ?? null,
                text: itemForReply.text,
              })
            }>
            {otherBubble}
          </MeetingChatSwipeToReply>
        </View>
      );
    },
    [
      myId,
      hostNorm,
      jumpToRepliedMessage,
      setReplyTo,
      onOpenUserProfile,
      openMeetingChatImageViewer,
      listRef,
      messageSearchHighlightQuery,
      menu.visible,
      menu.x,
      menu.y,
      menuActions,
      closeMenu,
      openMenuForRow,
      chatBubbleMaxWidthStyle,
      roomId,
      roomType,
      chatRenderMode,
      wmIdsForRead,
      participantIdsForUnread,
      peerId,
      peerReadStateReady,
      readMapsRevision,
      deleteMessageBestEffort,
    ],
  );
}
