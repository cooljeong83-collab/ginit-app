
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { type RefObject, useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';

import { meetingChatBodyStyles as styles } from '@/components/chat/meeting-chat-body-styles';
import { MeetingChatSwipeToReply } from '@/components/chat/meeting-chat-swipe-to-reply';
import {
  formatChatTime,
  profileForSender,
  replyPreviewText,
  replyTargetLabel,
} from '@/components/chat/meeting-chat-ui-helpers';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import type { UserProfile } from '@/src/lib/user-profile';
import { WITHDRAWN_NICKNAME, isUserProfileWithdrawn } from '@/src/lib/user-profile';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';

export type MeetingChatRenderItemDeps = {
  messages: MeetingChatMessage[];
  myId: string;
  hostNorm: string;
  profiles: Map<string, UserProfile>;
  unreadCountForMessage: (message: MeetingChatMessage, messageIndex: number) => number;
  jumpToRepliedMessage: (replyMessageId: string) => void | Promise<void>;
  setReplyTo: (v: MeetingChatMessage['replyTo']) => void;
  setPeerProfileUserId: (id: string) => void;
  openMeetingChatImageViewer: (item: MeetingChatMessage) => void;
  listRef: RefObject<unknown>;
};

export function useMeetingChatRenderItem({
  messages,
  myId,
  hostNorm,
  profiles,
  unreadCountForMessage,
  jumpToRepliedMessage,
  setReplyTo,
  setPeerProfileUserId,
  openMeetingChatImageViewer,
  listRef,
}: MeetingChatRenderItemDeps) {
  return useCallback(
    ({ item, index }: { item: MeetingChatMessage; index: number }) => {
      const prev = index > 0 ? messages[index - 1]! : null;
      const next = index + 1 < messages.length ? messages[index + 1]! : null;
      const currDate = item.createdAt?.toDate?.() ?? null;
      const nextDate = next?.createdAt?.toDate?.() ?? null;
      const dateLabel =
        currDate &&
        (!nextDate ||
          currDate.getFullYear() !== nextDate.getFullYear() ||
          currDate.getMonth() !== nextDate.getMonth() ||
          currDate.getDate() !== nextDate.getDate())
          ? currDate.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
          : '';

      if (item.kind === 'system') {
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
              <Text style={styles.systemText}>{item.text}</Text>
            </View>
          </View>
        );
      }
      const sid = item.senderId?.trim() ? normalizeParticipantId(item.senderId.trim()) : '';
      const isMine = Boolean(myId && sid && sid === myId);
      const prevSid =
        prev && prev.kind !== 'system' ? normalizeParticipantId(String(prev.senderId ?? '').trim()) : '';
      const sameSenderAsPrev = Boolean(sid && prevSid && prevSid === sid);
      const showAvatar = !isMine && sid && (index === 0 || !prev || prev.kind === 'system' || !sameSenderAsPrev);

      const prof = sid ? profileForSender(profiles, sid) : undefined;
      const withdrawn = isUserProfileWithdrawn(prof);
      const nick = withdrawn ? WITHDRAWN_NICKNAME : (prof?.nickname ?? '회원');
      const isHost = Boolean(hostNorm && sid && sid === hostNorm);
      const canOpenPeerProfile = Boolean(sid && !withdrawn && sid !== 'ginit_ai');

      const isImage = item.kind === 'image';
      const caption = item.text?.trim();

      if (isMine) {
        const unread = unreadCountForMessage(item, index);
        const bubble = (
          <View style={styles.rowMine}>
            <View style={styles.timeMineCol}>
              {unread > 0 ? (
                <Text style={styles.unreadBubbleCount} accessibilityLabel={`안 읽은 사람 ${unread}명`}>
                  {unread}
                </Text>
              ) : null}
              <Text style={styles.timeMine}>{formatChatTime(item.createdAt)}</Text>
            </View>
            <View style={[styles.bubbleMineWrap, isImage && styles.bubbleMineMedia]}>
              <BlurView tint="light" intensity={60} style={styles.bubbleMine}>
                {item.replyTo?.messageId ? (
                  <View style={styles.replyQuoteMine}>
                    <Pressable
                      onPress={() => void jumpToRepliedMessage(item.replyTo?.messageId ?? '')}
                      style={({ pressed }) => [styles.replyQuotePressable, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel="원글로 이동">
                      <View style={styles.replyQuoteTopRow}>
                        <View style={styles.replyQuoteTextCol}>
                          <Text style={styles.replyQuoteLabelMine}>
                            {replyTargetLabel(item.replyTo, profiles)}에게 답장
                          </Text>
                          <Text style={styles.replyQuoteTextMine} numberOfLines={2}>
                            {replyPreviewText(item.replyTo)}
                          </Text>
                        </View>
                        {item.replyTo.kind === 'image' && item.replyTo.imageUrl?.trim() ? (
                          <Image
                            source={{ uri: item.replyTo.imageUrl.trim() }}
                            style={styles.replyQuoteThumb}
                            contentFit="cover"
                          />
                        ) : null}
                      </View>
                    </Pressable>
                  </View>
                ) : null}
                {item.replyTo?.messageId ? <View style={styles.replyDivider} /> : null}
                {isImage ? (
                  item.imageUrl ? (
                    <Pressable
                      onPress={() => openMeetingChatImageViewer(item)}
                      style={({ pressed }) => [pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel="사진 크게 보기">
                      <Image source={{ uri: item.imageUrl }} style={styles.chatImage} contentFit="cover" />
                    </Pressable>
                  ) : (
                    <Text style={styles.bubbleMineText}>이미지를 불러올 수 없어요.</Text>
                  )
                ) : (
                  <Text style={styles.bubbleMineText}>{item.text}</Text>
                )}
                {isImage && caption ? <Text style={styles.imageCaptionMine}>{caption}</Text> : null}
              </BlurView>
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
                  messageId: item.id,
                  senderId: item.senderId ?? null,
                  kind: item.kind,
                  imageUrl: item.imageUrl ?? null,
                  text: item.text,
                })
              }
            >
              {bubble}
            </MeetingChatSwipeToReply>
          </View>
        );
      }

      const otherBubble = (
        <View style={styles.rowOther}>
          <Pressable
            style={styles.avatarCol}
            disabled={!canOpenPeerProfile}
            onPress={() => canOpenPeerProfile && setPeerProfileUserId(sid)}
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
                onPress={() => canOpenPeerProfile && setPeerProfileUserId(sid)}
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
              <View style={[styles.bubbleOtherOuter, isImage && styles.bubbleOtherMedia]}>
                <BlurView tint="light" intensity={60} style={styles.bubbleOther}>
                  {item.replyTo?.messageId ? (
                    <View style={styles.replyQuoteOther}>
                      <Pressable
                        onPress={() => void jumpToRepliedMessage(item.replyTo?.messageId ?? '')}
                        style={({ pressed }) => [styles.replyQuotePressable, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel="원글로 이동">
                        <View style={styles.replyQuoteTopRow}>
                          <View style={styles.replyQuoteTextCol}>
                            <Text style={styles.replyQuoteLabelOther}>
                              {replyTargetLabel(item.replyTo, profiles)}에게 답장
                            </Text>
                            <Text style={styles.replyQuoteTextOther} numberOfLines={2}>
                              {replyPreviewText(item.replyTo)}
                            </Text>
                          </View>
                          {item.replyTo.kind === 'image' && item.replyTo.imageUrl?.trim() ? (
                            <Image
                              source={{ uri: item.replyTo.imageUrl.trim() }}
                              style={styles.replyQuoteThumb}
                              contentFit="cover"
                            />
                          ) : null}
                        </View>
                      </Pressable>
                    </View>
                  ) : null}
                  {item.replyTo?.messageId ? <View style={styles.replyDivider} /> : null}
                  {isImage ? (
                    item.imageUrl ? (
                      <Pressable
                        onPress={() => openMeetingChatImageViewer(item)}
                        style={({ pressed }) => [pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel="사진 크게 보기">
                        <Image source={{ uri: item.imageUrl }} style={styles.chatImage} contentFit="cover" />
                      </Pressable>
                    ) : (
                      <Text style={styles.bubbleOtherText}>이미지를 불러올 수 없어요.</Text>
                    )
                  ) : (
                    <Text style={styles.bubbleOtherText}>{item.text}</Text>
                  )}
                  {isImage && caption ? <Text style={styles.imageCaptionOther}>{caption}</Text> : null}
                </BlurView>
                {sid === 'ginit_ai' ? <View style={styles.aiNeonOutline} pointerEvents="none" /> : null}
              </View>
              <Text style={styles.timeOther}>{formatChatTime(item.createdAt)}</Text>
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
                messageId: item.id,
                senderId: item.senderId ?? null,
                kind: item.kind,
                imageUrl: item.imageUrl ?? null,
                text: item.text,
              })
            }
          >
            {otherBubble}
          </MeetingChatSwipeToReply>
        </View>
      );
    },
    [
      messages,
      myId,
      hostNorm,
      profiles,
      unreadCountForMessage,
      jumpToRepliedMessage,
      setReplyTo,
      setPeerProfileUserId,
      openMeetingChatImageViewer,
      listRef,
    ],
  );
}
