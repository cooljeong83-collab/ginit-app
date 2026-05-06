
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { type RefObject, useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';

import { MeetingChatKakaoImageCluster } from '@/components/chat/MeetingChatKakaoImageCluster';
import { meetingChatBodyStyles as styles } from '@/components/chat/meeting-chat-body-styles';
import { MeetingChatSwipeToReply } from '@/components/chat/meeting-chat-swipe-to-reply';
import {
  formatChatTime,
  profileForSender,
  replyPreviewText,
  replyTargetLabel,
} from '@/components/chat/meeting-chat-ui-helpers';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import {
  meetingChatAlbumAnchorMessage,
  type MeetingChatListRow,
} from '@/src/lib/meeting-chat-list-rows';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import type { UserProfile } from '@/src/lib/user-profile';
import { WITHDRAWN_NICKNAME, isUserProfileWithdrawn } from '@/src/lib/user-profile';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';

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
}: MeetingChatRenderItemDeps) {
  return useCallback(
    ({ item, index }: { item: MeetingChatListRow; index: number }) => {
      const prev = index > 0 ? listRows[index - 1]! : null;
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
              <Text style={styles.systemText}>{sys.text}</Text>
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
      const prevSid = prev ? rowSenderNorm(prev) : '';
      const sameSenderAsPrev = Boolean(sid && prevSid && prevSid === sid);
      const showAvatar = !isMine && sid && (index === 0 || !prev || rowIsSystemRow(prev) || !sameSenderAsPrev);

      const prof = sid ? profileForSender(profiles, sid) : undefined;
      const withdrawn = isUserProfileWithdrawn(prof);
      const nick = withdrawn ? WITHDRAWN_NICKNAME : (prof?.nickname ?? '회원');
      const isHost = Boolean(hostNorm && sid && sid === hostNorm);
      const canOpenPeerProfile = Boolean(sid && !withdrawn && sid !== 'ginit_ai');

      const singleMsg = item.type === 'message' ? item.message : null;
      const isImage = Boolean(singleMsg && singleMsg.kind === 'image');
      const caption = singleMsg?.text?.trim();

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
        const kakaoClusterMine = isAlbum ? (
          <MeetingChatKakaoImageCluster messages={albumChrono} onPressImage={openMeetingChatImageViewer} alignEnd />
        ) : isImage && singleMsg?.imageUrl ? (
          <MeetingChatKakaoImageCluster messages={[singleMsg]} onPressImage={openMeetingChatImageViewer} alignEnd />
        ) : isImage ? (
          <Text style={styles.bubbleMineText}>이미지를 불러올 수 없어요.</Text>
        ) : null;
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
            {showKakaoPlain ? (
              <View style={[styles.bubbleMineWrap, styles.kakaoPlainMineWrap]}>
                {renderReply('mine')}
                {anchorMsg.replyTo?.messageId ? <View style={styles.replyDivider} /> : null}
                {kakaoClusterMine}
                {(isImage && caption) || (isAlbum && albumCaption) ? (
                  <Text style={styles.imageCaptionMine}>{isAlbum ? albumCaption : caption}</Text>
                ) : null}
              </View>
            ) : (
              <View style={styles.bubbleMineWrap}>
                <BlurView tint="light" intensity={60} style={styles.bubbleMine}>
                  {renderReply('mine')}
                  {anchorMsg.replyTo?.messageId ? <View style={styles.replyDivider} /> : null}
                  <Text style={styles.bubbleMineText}>{singleMsg?.text}</Text>
                </BlurView>
              </View>
            )}
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

      const kakaoClusterOther = isAlbum ? (
        <MeetingChatKakaoImageCluster messages={albumChrono} onPressImage={openMeetingChatImageViewer} />
      ) : isImage && singleMsg?.imageUrl ? (
        <MeetingChatKakaoImageCluster messages={[singleMsg]} onPressImage={openMeetingChatImageViewer} />
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
                <View style={[styles.bubbleOtherOuter, styles.kakaoPlainOtherOuter]}>
                  {renderReply('other')}
                  {anchorMsg.replyTo?.messageId ? <View style={styles.replyDivider} /> : null}
                  {kakaoClusterOther}
                  {(isImage && caption) || (isAlbum && albumCaption) ? (
                    <Text style={styles.imageCaptionOther}>{isAlbum ? albumCaption : caption}</Text>
                  ) : null}
                  {sid === 'ginit_ai' ? <View style={styles.aiNeonOutline} pointerEvents="none" /> : null}
                </View>
              ) : (
                <View style={styles.bubbleOtherOuter}>
                  <BlurView tint="light" intensity={60} style={styles.bubbleOther}>
                    {renderReply('other')}
                    {anchorMsg.replyTo?.messageId ? <View style={styles.replyDivider} /> : null}
                    <Text style={styles.bubbleOtherText}>{singleMsg?.text}</Text>
                  </BlurView>
                  {sid === 'ginit_ai' ? <View style={styles.aiNeonOutline} pointerEvents="none" /> : null}
                </View>
              )}
              <Text style={styles.timeOther}>{formatChatTime(anchorMsg.createdAt)}</Text>
            </View>
          </View>
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
    ],
  );
}
