
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { type RefObject, useCallback, useMemo, useState } from 'react';
import { Pressable, Share, Text, View } from 'react-native';

import { MeetingChatGinitImageCluster } from '@/components/chat/MeetingChatGinitImageCluster';
import { MeetingChatBubbleActionMenu } from '@/components/chat/MeetingChatBubbleActionMenu';
import { MeetingChatLinkPreviewCard } from '@/components/chat/MeetingChatLinkPreviewCard';
import { meetingChatBodyStyles as styles } from '@/components/chat/meeting-chat-body-styles';
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
  type MeetingChatListRow,
} from '@/src/lib/meeting-chat-list-rows';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import { copyMeetingChatListRowToClipboard, copyTextForMeetingChatListRow } from '@/src/lib/meeting-chat-bubble-copy';
import type { UserProfile } from '@/src/lib/user-profile';
import { WITHDRAWN_NICKNAME, isUserProfileWithdrawn } from '@/src/lib/user-profile';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { LinkableChatText } from '@/components/ui/LinkableChatText';

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
  unreadCountForMessage: (message: MeetingChatMessage, messageIndex: number) => number;
  jumpToRepliedMessage: (replyMessageId: string) => void | Promise<void>;
  setReplyTo: (v: MeetingChatMessage['replyTo']) => void;
  onOpenUserProfile: (id: string) => void;
  openMeetingChatImageViewer: (item: MeetingChatMessage) => void;
  listRef: RefObject<unknown>;
  /** 검색 확정어: 텍스트 말풍선(및 이미지 캡션) 내 일치 구간 하이라이트 */
  messageSearchHighlightQuery?: string;
};

export function useMeetingChatRenderItem({
  listRows,
  messageIndexById,
  myId,
  hostNorm,
  profiles,
  unreadCountForMessage,
  jumpToRepliedMessage,
  setReplyTo,
  onOpenUserProfile,
  openMeetingChatImageViewer,
  listRef,
  messageSearchHighlightQuery = '',
}: MeetingChatRenderItemDeps) {
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
    ];
  }, [menu.row, setReplyTo]);

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
      /** inverted + 최신순 data: index 작을수록 화면 아래(최신). `next` = 더 과거(위쪽) 이웃 */
      const next = index + 1 < listRows.length ? listRows[index + 1]! : null;
      const currDate = rowAnchorDate(item);
      const nextDate = next ? rowAnchorDate(next) : null;
      const dateLabel =
        currDate &&
        (!nextDate ||
          currDate.getFullYear() !== nextDate.getFullYear() ||
          currDate.getMonth() !== nextDate.getMonth() ||
          currDate.getDate() !== nextDate.getDate())
          ? currDate.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
          : '';

      if (item.type === 'message' && item.message.kind === 'system') {
        const sys = item.message;
        return (
          <View>
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

      const isAlbum = item.type === 'imageAlbum';
      const anchorMsg: MeetingChatMessage = isAlbum
        ? meetingChatAlbumAnchorMessage(item)
        : (item as Extract<MeetingChatListRow, { type: 'message' }>).message;
      const itemForReply: MeetingChatMessage = isAlbum
        ? meetingChatAlbumAnchorMessage(item)
        : (item as { type: 'message'; message: MeetingChatMessage }).message;

      const sid = rowSenderNorm(item);
      const isMine = Boolean(myId && sid && sid === myId);
      const nextSid = next ? rowSenderNorm(next) : '';
      const sameSenderAsNext = Boolean(sid && nextSid && nextSid === sid);
      /**
       * 상대 말풍선: (1) 항상 최신 1건은 표시 (2) 과거 이웃이 다른 사람·시스템이면 그룹 경계로 표시.
       * 예전에는 더 최신 이웃(`prev`)만 보아, 바로 위(과거)가 다른 사람인데 닉이 숨겨져 상대 글이 위 사람 연속으로 보이는 경우가 있었습니다.
       */
      const showAvatar =
        !isMine &&
        sid &&
        (index === 0 || !next || rowIsSystemRow(next) || !sameSenderAsNext);

      const prof = sid ? profileForSender(profiles, sid) : undefined;
      const withdrawn = isUserProfileWithdrawn(prof);
      const nick = withdrawn ? WITHDRAWN_NICKNAME : (prof?.nickname ?? '회원');
      const isHost = Boolean(hostNorm && sid && sid === hostNorm);
      const canOpenPeerProfile = Boolean(sid && !withdrawn && sid !== 'ginit_ai');

      const singleMsg = item.type === 'message' ? item.message : null;
      const isImage = Boolean(singleMsg && singleMsg.kind === 'image');
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
            <Pressable
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
                  />
                ) : null}
              </View>
            </Pressable>
          </View>
        );
      };

      if (isMine) {
        const unreadIdx = isAlbum
          ? flatUnreadIndex(messageIndexById, item.messages)
          : singleMsg
            ? (messageIndexById.get(singleMsg.id) ?? index)
            : index;
        const unreadMsg = isAlbum ? meetingChatAlbumAnchorMessage(item) : singleMsg!;
        const unread = unreadCountForMessage(unreadMsg, unreadIdx);
        const timeSource = anchorMsg.createdAt;
        const imageClusterMine = isAlbum ? (
          <MeetingChatGinitImageCluster messages={albumChrono} onPressImage={openMeetingChatImageViewer} alignEnd />
        ) : isImage && singleMsg?.imageUrl ? (
          <MeetingChatGinitImageCluster messages={[singleMsg]} onPressImage={openMeetingChatImageViewer} alignEnd />
        ) : isImage ? (
          <Text style={styles.bubbleMineText}>이미지를 불러올 수 없어요.</Text>
        ) : null;
        const bubbleMainMine = showKakaoPlain ? (
          <Pressable
            onLongPress={(e) => openMenuForRow(item, e)}
            delayLongPress={420}
            accessibilityLabel="말풍선 옵션"
            style={({ pressed }) => [[styles.bubbleMineWrap, styles.ginitPlainMineWrap], pressed && styles.pressed]}>
            {renderReply('mine')}
            {anchorMsg.replyTo?.messageId ? <View style={styles.replyDivider} /> : null}
            {imageClusterMine}
            {(isImage && caption) || (isAlbum && albumCaption) ? (
              bubbleText(isAlbum ? albumCaption : caption ?? '', styles.imageCaptionMine)
            ) : null}
          </Pressable>
        ) : isLinkOnlyText && singleMsg?.linkPreview ? (
          <Pressable
            onLongPress={(e) => openMenuForRow(item, e)}
            delayLongPress={420}
            accessibilityLabel="말풍선 옵션"
            style={({ pressed }) => [[styles.bubbleMineWrap, styles.ginitPlainMineWrap], pressed && styles.pressed]}>
            <MeetingChatLinkPreviewCard preview={singleMsg.linkPreview} mine rawUrlText={singleMsg.text} standalone />
          </Pressable>
        ) : (
          <Pressable
            onLongPress={(e) => openMenuForRow(item, e)}
            delayLongPress={420}
            accessibilityLabel="말풍선 옵션"
            style={({ pressed }) => [styles.bubbleMineWrap, pressed && styles.pressed]}>
            <BlurView tint="light" intensity={60} style={styles.bubbleMine}>
              {renderReply('mine')}
              {anchorMsg.replyTo?.messageId ? <View style={styles.replyDivider} /> : null}
              {bubbleText(singleMsg?.text, styles.bubbleMineText)}
              {singleMsg?.linkPreview?.url && singleMsg.linkPreview ? (
                <MeetingChatLinkPreviewCard preview={singleMsg.linkPreview} mine rawUrlText={extractFirstHttpUrlFromChatText(singleMsg?.text ?? '') ?? ''} />
              ) : null}
            </BlurView>
          </Pressable>
        );
        const bubble = (
          <View style={styles.rowMine}>
            <View style={styles.timeMineCol}>
              {unread > 0 ? (
                <Text style={styles.unreadBubbleCount} accessibilityLabel={`안 읽은 사람 ${unread}명`}>
                  {unread}
                </Text>
              ) : null}
              <Text style={styles.timeMine}>{formatChatTime(timeSource)}</Text>
            </View>
            {bubbleMainMine}
          </View>
        );
        return (
          <View>
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
          <Pressable
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
                <Image source={{ uri: prof.photoUrl }} style={styles.avatar} contentFit="cover" />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarFallbackText}>{nick.slice(0, 1)}</Text>
                </View>
              )
            ) : (
              <View style={styles.avatarSpacer} />
            )}
          </Pressable>
          <View style={styles.otherBlock} pointerEvents="box-none">
            {showAvatar ? (
              <Pressable
                disabled={!canOpenPeerProfile}
                onPress={() => canOpenPeerProfile && onOpenUserProfile(sid)}
                style={({ pressed }) => [styles.nameRow, canOpenPeerProfile && pressed && styles.pressed]}
                accessibilityRole={canOpenPeerProfile ? 'button' : undefined}
                accessibilityLabel={canOpenPeerProfile ? '프로필 보기' : undefined}>
                <Text style={styles.nickname} numberOfLines={1}>
                  {nick}
                </Text>
                {isHost ? <GinitSymbolicIcon name="star" size={14} color="#CA8A04" style={styles.crown} /> : null}
              </Pressable>
            ) : null}
            <View style={styles.bubbleOtherWrap}>
              {showKakaoPlain ? (
                <Pressable
                  onLongPress={(e) => openMenuForRow(item, e)}
                  delayLongPress={420}
                  accessibilityLabel="말풍선 옵션"
                  style={({ pressed }) => [[styles.bubbleOtherOuter, styles.ginitPlainOtherOuter], pressed && styles.pressed]}>
                  {renderReply('other')}
                  {anchorMsg.replyTo?.messageId ? <View style={styles.replyDivider} /> : null}
                  {imageClusterOther}
                  {(isImage && caption) || (isAlbum && albumCaption) ? (
                    bubbleText(isAlbum ? albumCaption : caption ?? '', styles.imageCaptionOther)
                  ) : null}
                  {sid === 'ginit_ai' ? <View style={styles.aiNeonOutline} pointerEvents="none" /> : null}
                </Pressable>
              ) : isLinkOnlyText && singleMsg?.linkPreview ? (
                <Pressable
                  onLongPress={(e) => openMenuForRow(item, e)}
                  delayLongPress={420}
                  accessibilityLabel="말풍선 옵션"
                  style={({ pressed }) => [styles.bubbleOtherOuter, pressed && styles.pressed]}>
                  <MeetingChatLinkPreviewCard preview={singleMsg.linkPreview} mine={false} rawUrlText={singleMsg.text} standalone />
                </Pressable>
              ) : (
                <View style={styles.bubbleOtherOuter}>
                  <Pressable
                    onLongPress={(e) => openMenuForRow(item, e)}
                    delayLongPress={420}
                    accessibilityLabel="말풍선 옵션"
                    style={({ pressed }) => [pressed && styles.pressed]}>
                    <BlurView tint="light" intensity={60} style={styles.bubbleOther}>
                      {renderReply('other')}
                      {anchorMsg.replyTo?.messageId ? <View style={styles.replyDivider} /> : null}
                      {bubbleText(singleMsg?.text, styles.bubbleOtherText)}
                      {singleMsg?.linkPreview?.url && singleMsg.linkPreview ? (
                        <MeetingChatLinkPreviewCard preview={singleMsg.linkPreview} mine={false} rawUrlText={extractFirstHttpUrlFromChatText(singleMsg?.text ?? '') ?? ''} />
                      ) : null}
                    </BlurView>
                    {sid === 'ginit_ai' ? <View style={styles.aiNeonOutline} pointerEvents="none" /> : null}
                  </Pressable>
                </View>
              )}
              <Text style={styles.timeOther}>{formatChatTime(anchorMsg.createdAt)}</Text>
            </View>
          </View>
        </View>
      );
      return (
        <View>
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
      listRows,
      messageIndexById,
      myId,
      hostNorm,
      profiles,
      unreadCountForMessage,
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
    ],
  );
}
