import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import type { Timestamp } from 'firebase/firestore';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
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
  /** `undefined`이면 아직 로딩 중, `null`이면 메시지 없음 */
  latestMessage: MeetingChatMessage | null | undefined;
  onPress: () => void;
};

export function ChatMeetingListRow({ meeting, hostPhotoUrl, hostNickname, latestMessage, onPress }: Props) {
  const title = meeting.title?.trim() || '모임';
  const place = placeLine(meeting);
  const pCount = meetingParticipantCount(meeting);

  const hasMessage = latestMessage != null;
  const loadingPreview = latestMessage === undefined;
  /** 대화가 없으면 당근 예시처럼 장소·시간 줄은 숨기고 모임명·소개만 둡니다. */
  const showMetaRow = loadingPreview || hasMessage;
  /** 장소 오른쪽(메타 줄) 시간은 마지막 채팅 시각만 사용 */
  const chatRel =
    hasMessage && latestMessage.createdAt ? formatRelativeFrom(latestMessage.createdAt) : '';
  const metaBits = [place, chatRel].filter(Boolean);
  const metaText = metaBits.join(' · ');

  const subtitle = hasMessage
    ? previewFromMessage(latestMessage)
    : (meeting.description?.trim() || '모임 소개가 아직 없어요.');

  /** 우측 상단 시각도 마지막 채팅 기준(대화 있을 때만) */
  const rightTime = hasMessage ? formatRightTime(latestMessage.createdAt) : '';

  const initial = (hostNickname?.trim() || '모').slice(0, 1);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${title} 채팅`}>
      <View style={styles.avatarWrap}>
        {hostPhotoUrl ? (
          <Image source={{ uri: hostPhotoUrl }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarFallbackText}>{initial}</Text>
          </View>
        )}
      </View>
      <View style={styles.body}>
        <View style={styles.topRow}>
          <View style={styles.titleBlock}>
            <View style={styles.titleWithIcon}>
              <Ionicons name="people" size={15} color="#94a3b8" style={styles.meetingIcon} />
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              <Text style={styles.participantCount} accessibilityLabel={`참여자 ${pCount}명`}>
                {pCount}
              </Text>
            </View>
            {showMetaRow && metaText ? (
              <Text style={styles.meta} numberOfLines={1}>
                {metaText}
              </Text>
            ) : null}
          </View>
          {rightTime ? (
            <Text style={styles.timeRight} numberOfLines={1}>
              {rightTime}
            </Text>
          ) : null}
        </View>
        <Text style={styles.subtitle} numberOfLines={2}>
          {loadingPreview ? '불러오는 중…' : subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8eaed',
    gap: 12,
  },
  rowPressed: {
    backgroundColor: '#f8fafc',
  },
  avatarWrap: {
    flexShrink: 0,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: '#e2e8f0',
  },
  avatarFallback: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 82, 204, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    fontSize: 20,
    fontWeight: '800',
    color: GinitTheme.trustBlue,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  titleWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  meetingIcon: {
    marginRight: 4,
    marginTop: 1,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    letterSpacing: -0.2,
  },
  participantCount: {
    flexShrink: 0,
    marginLeft: 6,
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
    minWidth: 18,
    textAlign: 'right',
  },
  meta: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '500',
  },
  timeRight: {
    flexShrink: 0,
    fontSize: 12,
    color: '#9ca3af',
    fontWeight: '500',
    marginTop: 2,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 19,
    color: '#6b7280',
    fontWeight: '400',
  },
});
