import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import { formatDistanceForList, meetingDistanceMetersFromUser, type LatLng } from '@/src/lib/geo-distance';
import { trimKoreanAddressToGuDistrict } from '@/src/lib/korean-address-display';
import type { Meeting, MeetingRecruitmentPhase } from '@/src/lib/meetings';
import {
  formatPublicMeetingAgeSummary,
  formatPublicMeetingApprovalSummary,
  formatPublicMeetingGenderSummary,
  formatPublicMeetingSettlementSummary,
  getMeetingRecruitmentPhase,
  MEETING_CAPACITY_UNLIMITED,
  meetingParticipantCount,
  parsePublicMeetingDetailsConfig,
} from '@/src/lib/meetings';

function meetingProgressPillStyles(phase: MeetingRecruitmentPhase) {
  switch (phase) {
    case 'confirmed':
      return {
        label: '확정',
        wrap: [rowStyles.progressBadge, { backgroundColor: GinitTheme.colors.primary }],
        text: [rowStyles.progressBadgeText, rowStyles.progressBadgeTextLight],
      };
    case 'full':
      return {
        label: '모집 완료',
        wrap: [rowStyles.progressBadge, { backgroundColor: GinitTheme.colors.accent2 }],
        text: [rowStyles.progressBadgeText, { color: GinitTheme.colors.text }],
      };
    default:
      return {
        label: '모집중',
        wrap: [rowStyles.progressBadge, { backgroundColor: GinitTheme.colors.success }],
        text: [rowStyles.progressBadgeText, rowStyles.progressBadgeTextLight],
      };
  }
}

function capacityFillRatio(m: Meeting): number {
  const n = meetingParticipantCount(m);
  const cap = m.capacity ?? 0;
  if (!cap || cap >= MEETING_CAPACITY_UNLIMITED) return Math.min(1, Math.max(0.12, n / 14));
  return Math.min(1, n / Math.max(cap, 1));
}

function voteEngagementRatio(m: Meeting): number {
  const log = m.participantVoteLog ?? [];
  const voted = log.filter(
    (e) =>
      (e.dateChipIds?.length ?? 0) + (e.placeChipIds?.length ?? 0) + (e.movieChipIds?.length ?? 0) >
      0,
  ).length;
  const n = meetingParticipantCount(m);
  return n > 0 ? Math.min(1, voted / n) : 0;
}

function capacitySummaryLine(m: Meeting): string {
  const n = meetingParticipantCount(m);
  const cap = m.capacity ?? 0;
  if (!cap || cap >= MEETING_CAPACITY_UNLIMITED) return `${n}명`;
  return `${n}/${cap}명`;
}

function categoryGlyph(m: Meeting): keyof typeof Ionicons.glyphMap {
  const hay = `${m.categoryLabel ?? ''} ${m.title ?? ''}`.toLowerCase();
  if (/영화|movie|film/.test(hay)) return 'film-outline';
  if (/운동|헬스|러닝|gym|fitness/.test(hay)) return 'barbell-outline';
  if (/맛집|식사|brunch|카페|술|food/.test(hay)) return 'restaurant-outline';
  if (/독서|책|book/.test(hay)) return 'book-outline';
  if (/음악|콘서트|music/.test(hay)) return 'musical-notes-outline';
  if (/산책|등산|walk|outdoor/.test(hay)) return 'walk-outline';
  return 'people-outline';
}

type Props = {
  meeting: Meeting;
  userCoords: LatLng | null;
  /** 내가 참여 중인 모임이면 파란 「참여중」 뱃지 표시 */
  joined?: boolean;
  onPress: () => void;
  /** 홈 2열 그리드 등 좁은 폭에서 타이포·여백 축소 */
  layoutDensity?: 'default' | 'compact';
};

/** 홈·채팅 공통 — 사진 없이 타일·막대·메타로 정보 전달 (팔레트는 GinitTheme만 사용) */
export function MeetingFeedRow({
  meeting: m,
  userCoords,
  joined = false,
  onPress,
  layoutDensity = 'default',
}: Props) {
  const compact = layoutDensity === 'compact';
  const tileSize = compact ? 76 : 88;
  const progressPill = meetingProgressPillStyles(getMeetingRecruitmentPhase(m));
  const capFill = useMemo(() => capacityFillRatio(m), [m]);
  const voteFill = useMemo(() => voteEngagementRatio(m), [m]);
  const glyph = useMemo(() => categoryGlyph(m), [m]);

  const publicCondLine = useMemo(() => {
    if (m.isPublic === false) return null;
    const cfg = parsePublicMeetingDetailsConfig(m.meetingConfig);
    if (!cfg) return null;
    return [
      formatPublicMeetingAgeSummary(cfg.ageLimit),
      formatPublicMeetingGenderSummary(cfg.genderRatio),
      formatPublicMeetingSettlementSummary(cfg.settlement, cfg.membershipFeeWon),
    ].join(' · ');
  }, [m]);

  const approvalLine = useMemo(() => {
    if (m.isPublic !== true) return null;
    const cfg = parsePublicMeetingDetailsConfig(m.meetingConfig);
    if (!cfg) return null;
    return formatPublicMeetingApprovalSummary(cfg.approvalType);
  }, [m]);

  const addrLine = useMemo(() => {
    const raw = (m.address?.trim() || m.location?.trim() || '').trim();
    if (!raw) return '';
    return trimKoreanAddressToGuDistrict(raw);
  }, [m.address, m.location]);

  const letter = useMemo(() => {
    const s = (m.categoryLabel?.trim() || m.title?.trim() || '?').trim();
    return s.charAt(0);
  }, [m.categoryLabel, m.title]);

  return (
    <View style={rowStyles.meetRowWrap}>
      <Pressable
        style={[rowStyles.meetRowInner, compact && rowStyles.meetRowInnerCompact, { gap: compact ? 10 : 14 }]}
        accessibilityRole="button"
        onPress={onPress}
        accessibilityHint="모임 상세로 이동">
        <View style={[rowStyles.visualTile, { width: tileSize, height: tileSize, borderRadius: compact ? 14 : 16 }]}>
          <LinearGradient
            colors={[...GinitTheme.colors.brandGradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={rowStyles.visualVeil} pointerEvents="none" />
          <Ionicons
            name={glyph}
            size={compact ? 22 : 26}
            color={GinitTheme.colors.primary}
            style={rowStyles.visualGlyph}
          />
          <Text style={[rowStyles.visualLetter, compact && rowStyles.visualLetterCompact]}>{letter}</Text>
          <View style={rowStyles.meterStack}>
            <View style={rowStyles.meterTrack}>
              <View style={[rowStyles.meterFillPrimary, { width: `${Math.round(capFill * 100)}%` }]} />
            </View>
            <View style={rowStyles.meterTrackThin}>
              <View style={[rowStyles.meterFillAccent, { width: `${Math.round(voteFill * 100)}%` }]} />
            </View>
            <Text style={rowStyles.meterCaption} numberOfLines={1}>
              {capacitySummaryLine(m)} · 투표 {Math.round(voteFill * 100)}%
            </Text>
          </View>
        </View>
        <View style={[rowStyles.meetBody, compact && rowStyles.meetBodyCompact]}>
          <View style={rowStyles.meetTitleRow}>
            <View style={rowStyles.meetTitleBlock}>
              <Text style={[rowStyles.meetTitle, compact && rowStyles.meetTitleCompact]} numberOfLines={compact ? 2 : 1}>
                {m.title}
              </Text>
              {addrLine ? (
                <Text style={[rowStyles.meetAddrLine, compact && rowStyles.metaCompact]} numberOfLines={1}>
                  {addrLine}
                </Text>
              ) : null}
            </View>
            <View style={[rowStyles.pillsStack, compact && rowStyles.pillsStackCompact]}>
              <View style={progressPill.wrap} accessibilityLabel={`진행 ${progressPill.label}`}>
                <Text style={progressPill.text} numberOfLines={1}>
                  {progressPill.label}
                </Text>
              </View>
              {joined ? (
                <View style={[rowStyles.progressBadge, { backgroundColor: GinitTheme.colors.primary }]} accessibilityLabel="참여 중인 모임">
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
              <Text style={[rowStyles.tagText, compact && rowStyles.metaCompact]} numberOfLines={1}>
                {[m.categoryLabel, `최대 ${m.capacity}명`].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {m.isPublic === false ? (
              <View style={rowStyles.lockPill}>
                <Text style={rowStyles.lockPillText}>비공개</Text>
              </View>
            ) : null}
            {approvalLine ? (
              <View style={rowStyles.approvalPill}>
                <Text style={[rowStyles.approvalPillText, compact && rowStyles.metaCompact]} numberOfLines={1}>
                  {approvalLine}
                </Text>
              </View>
            ) : null}
          </View>
          {m.scheduleDate && m.scheduleTime ? (
            <Text style={[rowStyles.schedule, compact && rowStyles.metaCompact]} numberOfLines={1}>
              {m.scheduleDate} {m.scheduleTime}
            </Text>
          ) : null}
          {publicCondLine ? (
            <Text style={[rowStyles.publicCondLine, compact && rowStyles.metaCompact]} numberOfLines={compact ? 2 : 1}>
              조건 · {publicCondLine}
            </Text>
          ) : null}
          <Text style={[rowStyles.price, compact && rowStyles.descCompact]} numberOfLines={compact ? 2 : 2}>
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
    borderRadius: GinitTheme.radius.card,
    backgroundColor: Platform.OS === 'android' ? GinitTheme.colors.surfaceStrong : 'transparent',
    ...GinitTheme.shadow.card,
  },
  meetRowInner: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderRadius: GinitTheme.radius.card,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    overflow: 'hidden',
  },
  meetRowInnerCompact: {
    padding: 10,
  },
  visualTile: {
    overflow: 'hidden',
    justifyContent: 'flex-end',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  visualVeil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.52)',
  },
  visualGlyph: {
    position: 'absolute',
    top: 8,
    right: 8,
    opacity: 0.85,
  },
  visualLetter: {
    position: 'absolute',
    top: 10,
    left: 10,
    fontSize: 26,
    fontWeight: '900',
    color: GinitTheme.colors.primary,
    letterSpacing: -0.5,
  },
  visualLetterCompact: {
    fontSize: 22,
    top: 8,
    left: 8,
  },
  meterStack: {
    paddingHorizontal: 8,
    paddingBottom: 8,
    gap: 4,
  },
  meterTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: GinitTheme.colors.border,
    overflow: 'hidden',
  },
  meterTrackThin: {
    height: 3,
    borderRadius: 999,
    backgroundColor: GinitTheme.colors.border,
    overflow: 'hidden',
  },
  meterFillPrimary: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: GinitTheme.colors.primary,
  },
  meterFillAccent: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: GinitTheme.colors.accent,
  },
  meterCaption: {
    fontSize: 9,
    fontWeight: '800',
    color: GinitTheme.colors.textMuted,
  },
  meetBody: {
    flex: 1,
    justifyContent: 'center',
    gap: 6,
    minWidth: 0,
  },
  meetBodyCompact: {
    gap: 4,
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
  pillsStackCompact: {
    maxWidth: 72,
  },
  progressBadge: {
    flexShrink: 0,
    maxWidth: 88,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  progressBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
  },
  progressBadgeTextLight: { color: GinitTheme.colors.textOnDark },
  meetTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: GinitTheme.colors.text,
  },
  meetTitleCompact: {
    fontSize: 14,
    lineHeight: 19,
  },
  meetAddrLine: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
  },
  metaCompact: {
    fontSize: 10,
  },
  descCompact: {
    fontSize: 12,
    lineHeight: 16,
  },
  meetDistChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: GinitTheme.colors.primarySoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  meetDistChipText: {
    fontSize: 12,
    fontWeight: '800',
    color: GinitTheme.colors.primary,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  tagPill: {
    alignSelf: 'flex-start',
    backgroundColor: GinitTheme.colors.bgAlt,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.textSub,
  },
  lockPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: GinitTheme.colors.primarySoft,
  },
  lockPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: GinitTheme.colors.primary,
  },
  approvalPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: GinitTheme.colors.bgAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  approvalPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: GinitTheme.colors.textSub,
  },
  schedule: {
    fontSize: 12,
    fontWeight: '700',
    color: GinitTheme.colors.textMuted,
  },
  publicCondLine: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
  },
  price: {
    fontSize: 13,
    fontWeight: '500',
    color: GinitTheme.colors.textSub,
    lineHeight: 18,
  },
});
