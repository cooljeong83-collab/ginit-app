import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import type { Timestamp } from 'firebase/firestore';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ChatListCardShell } from '@/components/chat/ChatListCardShell';
import { GinitTheme } from '@/constants/ginit-theme';
import { getHomeCategoryVisual } from '@/src/lib/feed-home-visual';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import type { Meeting } from '@/src/lib/meetings';
import { meetingParticipantCount } from '@/src/lib/meetings';

function formatRelativeFrom(ts: Timestamp | null | undefined): string {
  if (!ts || typeof ts.toDate !== 'function') return '';
  try {
    const d = ts.toDate();
    const diffMs = Date.now() - d.getTime();
    if (diffMs < 0) return '';
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return '방금';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}분 전`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}시간 전`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}일 전`;
    const week = Math.floor(day / 7);
    if (week < 6) return `${week}주 전`;
    return d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
  } catch {
    return '';
  }
}

function formatRightTime(messageTs: Timestamp | null | undefined): string {
  const ts = messageTs;
  if (!ts || typeof ts.toDate !== 'function') return '';
  try {
    const d = ts.toDate();
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) {
      return d.toLocaleTimeString('ko-KR', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    }
    return formatRelativeFrom(ts);
  } catch {
    return '';
  }
}

function previewFromMessage(m: MeetingChatMessage): string {
  if (m.kind === 'system') return m.text?.trim() ? m.text.trim() : '알림';
  if (m.kind === 'image') return m.text?.trim() ? `사진 · ${m.text.trim()}` : '사진';
  return m.text?.trim() ?? '';
}

function placeLine(meeting: Meeting): string {
  const p = meeting.placeName?.trim() || meeting.location?.trim() || meeting.address?.trim() || '';
  return p;
}

type Props = {
  meeting: Meeting;
  hostPhotoUrl: string | null;
  hostNickname: string;
  /** 탈퇴·익명화된 주관자 — 회색 기본 아이콘만 표시 */
  hostWithdrawn?: boolean;
  /** `undefined`이면 아직 로딩 중, `null`이면 메시지 없음 */
  latestMessage: MeetingChatMessage | null | undefined;
  /** 읽지 않은 새 메시지 수(목록 우측 시간 아래) */
  unreadCount?: number;
  onPress: () => void;
};

export function ChatMeetingListRow({
  meeting,
  hostPhotoUrl,
  hostNickname,
  hostWithdrawn,
  latestMessage,
  unreadCount = 0,
  onPress,
}: Props) {
  const visual = useMemo(() => getHomeCategoryVisual(meeting), [meeting]);
  const title = meeting.title?.trim() || '모임';
  const place = placeLine(meeting);
  const pCount = meetingParticipantCount(meeting);

  const hasMessage = latestMessage != null;
  const loadingPreview = latestMessage === undefined;
  const showMetaRow = loadingPreview || hasMessage;
  const chatRel =
    hasMessage && latestMessage.createdAt ? formatRelativeFrom(latestMessage.createdAt) : '';
  const metaBits = [place, chatRel].filter(Boolean);
  const metaText = metaBits.join(' · ');

  const subtitle = hasMessage
    ? previewFromMessage(latestMessage)
    : (meeting.description?.trim() || '모임 소개가 아직 없어요.');

  const rightTime = hasMessage ? formatRightTime(latestMessage.createdAt) : '';

  const initial = (hostNickname?.trim() || '모').slice(0, 1);

  return (
    <ChatListCardShell accentGradient={visual.gradient} onPress={onPress} accessibilityLabel={`${title} 채팅`}>
      <View style={styles.zoneA}>
        <View style={styles.symbolCol}>
          {hostWithdrawn ? (
            <View style={styles.hostBubble}>
              <View style={styles.hostWithdrawnInner}>
                <Ionicons name="person" size={16} color="#94a3b8" />
              </View>
            </View>
          ) : hostPhotoUrl ? (
            <View style={styles.hostBubble}>
              <Image
                source={{ uri: hostPhotoUrl }}
                style={styles.hostBubbleImg}
                contentFit="cover"
                cachePolicy="disk"
                recyclingKey={hostPhotoUrl}
              />
            </View>
          ) : (
            <View style={styles.hostBubble}>
              <View style={styles.hostFallback}>
                <Text style={styles.hostFallbackText}>{initial}</Text>
              </View>
            </View>
          )}
          <Text style={styles.capacityCountLabel} numberOfLines={1} accessibilityLabel={`참여자 ${pCount}명`}>
            {pCount}명
          </Text>
        </View>
        <View style={styles.zoneAMain}>
          <View style={styles.titleRow}>
            <View style={styles.titleBlock}>
              <Text style={styles.heroTitle} numberOfLines={1}>
                {title}
              </Text>
              {showMetaRow && metaText ? (
                <Text style={styles.metaMuted} numberOfLines={1}>
                  {metaText}
                </Text>
              ) : null}
            </View>
            {rightTime || unreadCount > 0 ? (
              <View style={styles.timeColumn}>
                {rightTime ? (
                  <Text style={styles.timeRight} numberOfLines={1}>
                    {rightTime}
                  </Text>
                ) : null}
                {unreadCount > 0 ? (
                  <Text
                    style={[styles.unreadListCount, !rightTime && styles.unreadListCountSolo]}
                    accessibilityLabel={`읽지 않은 메시지 ${unreadCount > 99 ? '99개 이상' : `${unreadCount}개`}`}>
                    {unreadCount > 99 ? '99+' : String(unreadCount)}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
          <Text style={styles.previewLine} numberOfLines={2}>
            {loadingPreview ? '불러오는 중…' : subtitle}
          </Text>
        </View>
      </View>
    </ChatListCardShell>
  );
}

const styles = StyleSheet.create({
  zoneA: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  symbolCol: {
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    paddingTop: 1,
  },
  hostBubble: {
    width: 32,
    height: 32,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    backgroundColor: GinitTheme.colors.surfaceStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hostBubbleImg: {
    width: '100%',
    height: '100%',
  },
  hostWithdrawnInner: {
    width: '100%',
    height: '100%',
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hostFallback: {
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0, 82, 204, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hostFallbackText: {
    fontSize: 13,
    fontWeight: '900',
    color: GinitTheme.trustBlue,
  },
  capacityCountLabel: {
    marginTop: 0,
    fontSize: 9,
    fontWeight: '800',
    color: GinitTheme.colors.textMuted,
    letterSpacing: -0.35,
    textAlign: 'center',
    maxWidth: 40,
  },
  zoneAMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    minWidth: 0,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  heroTitle: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.2,
    lineHeight: 18,
    color: GinitTheme.colors.text,
  },
  metaMuted: {
    fontSize: 11,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    letterSpacing: -0.12,
  },
  timeColumn: {
    flexShrink: 0,
    maxWidth: '38%',
    alignItems: 'flex-end',
    gap: 2,
  },
  timeRight: {
    fontSize: 11,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    letterSpacing: -0.12,
    marginTop: 1,
    textAlign: 'right',
  },
  unreadListCount: {
    fontSize: 11,
    fontWeight: '900',
    color: '#FA3E3E',
    letterSpacing: -0.2,
    textAlign: 'right',
  },
  unreadListCountSolo: {
    marginTop: 1,
  },
  previewLine: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 17,
    color: GinitTheme.colors.textSub,
    letterSpacing: -0.1,
  },
});
