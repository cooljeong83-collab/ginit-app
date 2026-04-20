import { Image } from 'expo-image';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import { formatDistanceForList, meetingDistanceMetersFromUser, type LatLng } from '@/src/lib/geo-distance';
import { resolveMeetingListThumbnailUri } from '@/src/lib/meeting-list-thumbnail';
import type { Meeting, MeetingRecruitmentPhase } from '@/src/lib/meetings';
import { getMeetingRecruitmentPhase } from '@/src/lib/meetings';

function meetingProgressPillStyles(phase: MeetingRecruitmentPhase) {
  switch (phase) {
    case 'confirmed':
      return {
        label: '확정',
        wrap: [rowStyles.progressBadge, rowStyles.progressBadgeBlack],
        text: [rowStyles.progressBadgeText, rowStyles.progressBadgeTextLight],
      };
    case 'full':
      return {
        label: '모집 완료',
        wrap: [rowStyles.progressBadge, rowStyles.progressBadgeYellow],
        text: [rowStyles.progressBadgeText, rowStyles.progressBadgeTextOnYellow],
      };
    default:
      return {
        label: '모집중',
        wrap: [rowStyles.progressBadge, rowStyles.progressBadgeGreen],
        text: [rowStyles.progressBadgeText, rowStyles.progressBadgeTextLight],
      };
  }
}

type Props = {
  meeting: Meeting;
  userCoords: LatLng | null;
  /** 내가 참여 중인 모임이면 파란 「참여중」 뱃지 표시 */
  joined?: boolean;
  onPress: () => void;
};

/** 홈 피드와 동일한 모임 한 줄 카드 */
export function MeetingFeedRow({ meeting: m, userCoords, joined = false, onPress }: Props) {
  const progressPill = meetingProgressPillStyles(getMeetingRecruitmentPhase(m));
  return (
    <View style={rowStyles.meetRowWrap}>
      <Pressable
        style={rowStyles.meetRowInner}
        accessibilityRole="button"
        onPress={onPress}
        accessibilityHint="모임 상세로 이동">
        <Image source={{ uri: resolveMeetingListThumbnailUri(m) }} style={rowStyles.thumb} contentFit="cover" />
        <View style={rowStyles.meetBody}>
          <View style={rowStyles.meetTitleRow}>
            <View style={rowStyles.meetTitleBlock}>
              <Text style={rowStyles.meetTitle} numberOfLines={1}>
                {m.title}
              </Text>
              {m.address?.trim() || m.location ? (
                <Text style={rowStyles.meetAddrLine} numberOfLines={1}>
                  {m.address?.trim() || m.location}
                </Text>
              ) : null}
            </View>
            <View style={rowStyles.pillsStack}>
              <View style={progressPill.wrap} accessibilityLabel={`진행 ${progressPill.label}`}>
                <Text style={progressPill.text} numberOfLines={1}>
                  {progressPill.label}
                </Text>
              </View>
              {joined ? (
                <View
                  style={[rowStyles.progressBadge, rowStyles.progressBadgeBlue]}
                  accessibilityLabel="참여 중인 모임">
                  <Text style={[rowStyles.progressBadgeText, rowStyles.progressBadgeTextLight]} numberOfLines={1}>
                    참여중
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
          <View style={rowStyles.tagRow}>
            <View
              style={rowStyles.meetDistChip}
              accessibilityLabel={`내 위치에서 ${formatDistanceForList(meetingDistanceMetersFromUser(m, userCoords))}`}>
              <Text style={rowStyles.meetDistChipText}>
                {formatDistanceForList(meetingDistanceMetersFromUser(m, userCoords))}
              </Text>
            </View>
            <View style={rowStyles.tagPill}>
              <Text style={rowStyles.tagText} numberOfLines={1}>
                {[m.categoryLabel, `최대 ${m.capacity}명`].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {m.isPublic === false ? (
              <View style={rowStyles.lockPill}>
                <Text style={rowStyles.lockPillText}>비공개</Text>
              </View>
            ) : null}
          </View>
          {m.scheduleDate && m.scheduleTime ? (
            <Text style={rowStyles.schedule} numberOfLines={1}>
              {m.scheduleDate} {m.scheduleTime}
            </Text>
          ) : null}
          <Text style={rowStyles.price} numberOfLines={2}>
            {m.description}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  meetRowWrap: {
    marginBottom: 14,
    borderRadius: 20,
    backgroundColor: Platform.OS === 'android' ? '#FFFFFF' : 'transparent',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  meetRowInner: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: 20,
    padding: 12,
    gap: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.06)',
    overflow: 'hidden',
  },
  thumb: {
    width: 88,
    height: 88,
    borderRadius: 16,
    backgroundColor: '#e2e8f0',
  },
  meetBody: {
    flex: 1,
    justifyContent: 'center',
    gap: 6,
  },
  meetTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    minWidth: 0,
  },
  meetTitleBlock: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'column',
    gap: 2,
  },
  pillsStack: {
    flexShrink: 0,
    alignItems: 'flex-end',
    gap: 4,
    maxWidth: 88,
  },
  progressBadge: {
    flexShrink: 0,
    maxWidth: 88,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  progressBadgeGreen: { backgroundColor: '#16A34A' },
  progressBadgeBlue: { backgroundColor: GinitTheme.trustBlue },
  progressBadgeYellow: { backgroundColor: '#FACC15' },
  progressBadgeBlack: { backgroundColor: '#171717' },
  progressBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },
  progressBadgeTextLight: { color: '#fff' },
  progressBadgeTextOnYellow: { color: '#422006' },
  meetTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  meetAddrLine: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  meetDistChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 82, 204, 0.1)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0, 82, 204, 0.2)',
  },
  meetDistChipText: {
    fontSize: 12,
    fontWeight: '800',
    color: GinitTheme.trustBlue,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  tagPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  lockPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 82, 204, 0.1)',
  },
  lockPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: GinitTheme.trustBlue,
  },
  schedule: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  price: {
    fontSize: 13,
    fontWeight: '500',
    color: '#334155',
    lineHeight: 18,
  },
});
