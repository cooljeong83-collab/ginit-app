import { GinitPressable } from '@/components/ui/GinitPressable';

import type { Timestamp } from 'firebase/firestore';
import {StyleSheet, Text, View} from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import { MeetingListThumbnailImage } from '@/components/feed/MeetingListThumbnailImage';
import type { Category } from '@/src/lib/categories';
import { categoryEmojiForMeeting } from '@/src/lib/friend-presence-activity';
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
  /** 홈·지도 모임 목록과 동일한 카테고리 이모지(미전달 시 휴리스틱 폴백) */
  categories?: readonly Category[] | null;
  onPress: () => void;
};

export function ChatMeetingListRow({
  meeting,
  hostPhotoUrl: _hostPhotoUrl,
  hostNickname: _hostNickname,
  hostWithdrawn: _hostWithdrawn,
  latestMessage,
  unreadCount = 0,
  categories = null,
  onPress,
}: Props) {
  const title = meeting.title?.trim() || '모임';
  const place = placeLine(meeting);
  const pCount = meetingParticipantCount(meeting);
  const capacity = typeof meeting.capacity === 'number' && meeting.capacity > 0 ? meeting.capacity : 0;
  const capFill = capacity > 0 ? Math.min(1, Math.max(0, pCount / capacity)) : 0;
  const showCapacityBar = capacity > 0;

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

  const categoryEmoji = categoryEmojiForMeeting(meeting, categories);

  return (
    <GinitPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title} 채팅`}
      style={({ pressed }) => [styles.pressableRow, pressed && styles.pressablePressed]}>
      <View style={styles.zoneA}>
        <View style={styles.symbolCol}>
          <View style={styles.meetingThumbRing} accessibilityLabel="모임 썸네일">
            <MeetingListThumbnailImage meeting={meeting} style={styles.meetingThumbImg} recyclingKey={meeting.id} />
            <View style={styles.meetingThumbCornerEmojiBadge} accessibilityLabel="카테고리">
              <Text style={styles.meetingThumbCornerEmojiText} allowFontScaling={false}>
                {categoryEmoji}
              </Text>
            </View>
          </View>
          {showCapacityBar ? (
            <View style={styles.capRow} accessibilityLabel={`참여 인원 ${pCount}명, 최대 ${capacity}명`}>
              <View style={styles.capTrack}>
                <View style={[styles.capFill, { width: `${Math.round(capFill * 100)}%` }]} />
              </View>
              <Text style={styles.capLabel} numberOfLines={1}>
                {`${pCount}/${capacity}`}
              </Text>
            </View>
          ) : null}
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
                  <View
                    style={[styles.unreadBadge, !rightTime && styles.unreadBadgeSolo]}
                    accessibilityLabel={`읽지 않은 메시지 ${unreadCount > 99 ? '99개 이상' : `${unreadCount}개`}`}>
                    <Text style={styles.unreadBadgeText}>{unreadCount > 99 ? '99+' : String(unreadCount)}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
          <Text style={styles.previewLine} numberOfLines={2}>
            {loadingPreview ? '불러오는 중…' : subtitle}
          </Text>
        </View>
      </View>
    </GinitPressable>
  );
}

const styles = StyleSheet.create({
  pressableRow: {
    paddingVertical: 10,
  },
  pressablePressed: {
    opacity: 0.86,
  },
  zoneA: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  symbolCol: {
    flexShrink: 0,
    alignItems: 'center',
    paddingTop: 1,
  },
  /** 모임 목록 썸네일과 동일 톤(크기만 축소) */
  meetingThumbRing: {
    width: 52,
    height: 52,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    backgroundColor: GinitTheme.colors.bgAlt,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  meetingThumbImg: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 7,
  },
  meetingThumbCornerEmojiBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 0,
    zIndex: 4,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  meetingThumbCornerEmojiText: {
    fontSize: 12,
    fontWeight: '800',
  },
  capRow: {
    marginTop: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: 52,
  },
  capTrack: {
    flex: 1,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.10)',
    overflow: 'hidden',
  },
  capFill: {
    height: '100%',
    backgroundColor: GinitTheme.colors.primary,
  },
  capLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
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
    fontWeight: '600',
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
  unreadBadge: {
    marginTop: 2,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 999,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
  },
  unreadBadgeSolo: {
    marginTop: 1,
  },
  unreadBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: -0.2,
    lineHeight: 12,
  },
  previewLine: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 17,
    color: GinitTheme.colors.textMuted,
    letterSpacing: -0.1,
  },
});
