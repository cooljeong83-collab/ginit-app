import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import { formatDistanceForList, meetingDistanceMetersFromUser, type LatLng } from '@/src/lib/geo-distance';
import { meetingScheduleStartMs } from '@/src/lib/feed-meeting-utils';
import { homeMeetingStatusBadgeLabel } from '@/src/lib/feed-home-visual';
import { GINIT_HIGH_TRUST_HOST_MIN, isHighTrustPublicMeeting } from '@/src/lib/ginit-trust';
import type { Meeting } from '@/src/lib/meetings';
import {
  formatPublicMeetingAgeSummary,
  formatPublicMeetingApprovalSummary,
  formatPublicMeetingGenderSummary,
  formatPublicMeetingSettlementSummary,
  MEETING_CAPACITY_UNLIMITED,
  meetingParticipantCount,
  parsePublicMeetingDetailsConfig,
} from '@/src/lib/meetings';

function capacitySummaryLine(m: Meeting): string {
  const n = meetingParticipantCount(m);
  const cap = m.capacity ?? 0;
  if (!cap || cap >= MEETING_CAPACITY_UNLIMITED) return `${n}명`;
  return `${n}/${cap}명`;
}

/** 정원 대비 참여 비율(무제한 정원이면 상대 막대 길이만 표시) */
function capacityFillRatio(m: Meeting): number {
  const n = meetingParticipantCount(m);
  const cap = m.capacity ?? 0;
  if (!cap || cap >= MEETING_CAPACITY_UNLIMITED) return Math.min(1, Math.max(0.12, n / 16));
  return Math.min(1, n / Math.max(cap, 1));
}

/**
 * 막대 색: 초기(≤50%) 녹색 → 과반(>50%) 경고 앰버 → 정원 마감 시 브랜드 네이비(‘마감’은 강조보다 안정감).
 * 무제한 정원은 막대 비율(capFill)로 동일 구간 적용.
 */
function participantBarFillColor(m: Meeting, capFill: number): string {
  const n = meetingParticipantCount(m);
  const cap = m.capacity ?? 0;
  const finite = cap > 0 && cap < MEETING_CAPACITY_UNLIMITED;
  const ratio = finite ? n / Math.max(cap, 1) : capFill;
  if (finite && n >= cap) return GinitTheme.colors.primary;
  if (ratio >= 1) return GinitTheme.colors.primary;
  if (ratio > 0.5) return GinitTheme.colors.warning;
  return GinitTheme.colors.success;
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

/** 공개 모임 상세 조건 — 홈 그리드 한 줄 칩(가로 스크롤)용 */
function publicMeetingConditionChips(m: Meeting): { key: string; label: string }[] {
  if (m.isPublic !== true) return [];
  const cfg = parsePublicMeetingDetailsConfig(m.meetingConfig);
  if (!cfg) return [];
  const chips: { key: string; label: string }[] = [];
  chips.push({ key: 'age', label: formatPublicMeetingAgeSummary(cfg.ageLimit) });
  chips.push({ key: 'gender', label: formatPublicMeetingGenderSummary(cfg.genderRatio) });
  chips.push({
    key: 'settle',
    label: formatPublicMeetingSettlementSummary(cfg.settlement, cfg.membershipFeeWon),
  });
  chips.push({ key: 'glv', label: `참가 Lv${cfg.minGLevel}+` });
  if (typeof cfg.minGTrust === 'number' && Number.isFinite(cfg.minGTrust)) {
    const hostMin = Math.trunc(cfg.minGTrust);
    const needFinal = isHighTrustPublicMeeting(cfg) ? Math.max(GINIT_HIGH_TRUST_HOST_MIN, hostMin) : hostMin;
    chips.push({ key: 'trust', label: `신뢰≥${needFinal}` });
  }
  chips.push({ key: 'appr', label: formatPublicMeetingApprovalSummary(cfg.approvalType) });
  return chips;
}

function formatDdayLabel(m: Meeting): string | null {
  const ms = meetingScheduleStartMs(m);
  if (ms == null) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.ceil((ms - Date.now()) / dayMs);
  if (diffDays === 0) return 'D-Day';
  if (diffDays > 0 && diffDays <= 99) return `D-${diffDays}`;
  if (diffDays < 0) return '지난 일정';
  return null;
}

type Props = {
  meeting: Meeting;
  userCoords: LatLng | null;
  joined: boolean;
  onPress: () => void;
};

/** 홈 탭 모임 카드 — 좌측 심볼+카테고리 하단 참여 막대, 거리·D-Day 메타 */
export function HomeMeetingListItem({ meeting: m, userCoords, joined, onPress }: Props) {
  const glyph = useMemo(() => categoryGlyph(m), [m]);
  const categoryLabel = m.categoryLabel?.trim() ?? '';
  const statusCorner = useMemo(() => homeMeetingStatusBadgeLabel(m), [m]);
  const dday = useMemo(() => formatDdayLabel(m), [m]);
  const statusBadgeStyle = useMemo(() => {
    if (statusCorner === '내일 모임') return { wrap: s.statusBadgeTomorrow, text: s.statusBadgeTextDark };
    if (statusCorner === '확정') return { wrap: s.statusBadgeConfirmed, text: s.statusBadgeTextOnPrimary };
    return { wrap: s.statusBadgeCoordinating, text: s.statusBadgeTextPrimary };
  }, [statusCorner]);

  const distanceChipText = useMemo(
    () => formatDistanceForList(meetingDistanceMetersFromUser(m, userCoords)),
    [m, userCoords],
  );
  const peopleChip = capacitySummaryLine(m);
  const capFill = useMemo(() => capacityFillRatio(m), [m]);
  const barFillColor = useMemo(() => participantBarFillColor(m, capFill), [m, capFill]);
  const showDdayMeta = dday != null && statusCorner !== '내일 모임';
  const condChips = useMemo(() => publicMeetingConditionChips(m), [m]);

  return (
    <View style={s.meetRowWrap}>
      <Pressable
        style={s.meetRowInner}
        accessibilityRole="button"
        onPress={onPress}
        accessibilityHint="모임 상세로 이동">
        <View style={s.topRow}>
          <View style={s.symbolCol}>
            <View style={[s.symbolCircle, categoryLabel ? s.symbolCircleTall : s.symbolCircleCompact]}>
              <LinearGradient
                colors={[...GinitTheme.colors.brandGradient]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />
              <View style={s.symbolVeil} pointerEvents="none" />
              <View style={s.symbolCircleColumn}>
                <View style={[s.symbolCircleInner, categoryLabel ? s.symbolCircleInnerWithCat : null]}>
                  <Ionicons
                    name={glyph}
                    size={categoryLabel ? 17 : 22}
                    color={GinitTheme.colors.primary}
                    style={categoryLabel ? s.symbolGlyphWithLabel : undefined}
                  />
                  {categoryLabel ? (
                    <Text style={s.symbolCategoryText} numberOfLines={2}>
                      {categoryLabel}
                    </Text>
                  ) : null}
                </View>
                <View style={s.symbolBarSection}>
                  <View style={s.symbolParticipantTrack}>
                    <View
                      style={[
                        s.symbolParticipantFill,
                        { width: `${Math.round(capFill * 100)}%`, backgroundColor: barFillColor },
                      ]}
                    />
                  </View>
                  <Text style={s.symbolParticipantCaption} numberOfLines={1}>
                    {peopleChip}
                  </Text>
                </View>
              </View>
            </View>
          </View>
          <View style={s.mainCol}>
            <View style={s.titleRow}>
              <Text style={s.heroTitle} numberOfLines={2}>
                {m.title}
              </Text>
              <View style={s.cornerBadges}>
                <View style={[s.statusBadgeBase, statusBadgeStyle.wrap]}>
                  <Text style={[s.statusBadgeTextBase, statusBadgeStyle.text]} numberOfLines={1}>
                    {statusCorner}
                  </Text>
                </View>
                {joined ? (
                  <View style={[s.progressBadge, { backgroundColor: GinitTheme.colors.primary }]}>
                    <Text style={[s.progressBadgeText, s.progressBadgeTextLight]} numberOfLines={1}>
                      참여중
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
            <View style={s.metaChipRow}>
              <View style={s.metaChip}>
                <Text style={s.metaChipText} numberOfLines={1}>
                  {distanceChipText}
                </Text>
              </View>
              {showDdayMeta ? (
                <View style={[s.metaChip, s.metaDdayChip]}>
                  <Text style={[s.metaChipText, s.metaDdayChipText]} numberOfLines={1}>
                    {dday}
                  </Text>
                </View>
              ) : null}
            </View>
            {condChips.length > 0 ? (
              <ScrollView
                horizontal
                nestedScrollEnabled
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                style={s.condScrollView}
                contentContainerStyle={s.condChipRow}>
                {condChips.map((c) => (
                  <View key={c.key} style={s.condChip} accessibilityLabel={c.label}>
                    <Text style={s.condChipText} numberOfLines={1} ellipsizeMode="tail">
                      {c.label}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            ) : null}
            <View style={s.distRow}>
              {m.isPublic === false ? (
                <View style={s.lockPill}>
                  <Text style={s.lockPillText}>비공개</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  meetRowWrap: {
    marginBottom: 14,
    borderRadius: GinitTheme.radius.card,
    backgroundColor: Platform.OS === 'android' ? GinitTheme.colors.surfaceStrong : 'transparent',
    ...GinitTheme.shadow.card,
  },
  meetRowInner: {
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderRadius: GinitTheme.radius.card,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    overflow: 'hidden',
    gap: 7,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  symbolCol: {
    flexShrink: 0,
  },
  symbolCircle: {
    width: 56,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    position: 'relative',
  },
  symbolCircleCompact: {
    height: 70,
    minHeight: 70,
  },
  symbolCircleTall: {
    minHeight: 84,
  },
  symbolCircleColumn: {
    flex: 1,
    width: '100%',
    minHeight: 0,
    zIndex: 1,
    flexDirection: 'column',
  },
  symbolCircleInner: {
    flex: 1,
    width: '100%',
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 4,
    gap: 2,
  },
  /** 막대 하단 고정 — 아이콘·카테고리명은 그 위 영역에서 세로 중앙 */
  symbolCircleInnerWithCat: {
    justifyContent: 'center',
    paddingVertical: 4,
  },
  symbolGlyphWithLabel: {
    marginTop: 0,
  },
  symbolCategoryText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
    lineHeight: 11,
    letterSpacing: -0.2,
    opacity: 0.92,
  },
  symbolVeil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.52)',
  },
  symbolBarSection: {
    width: '100%',
    alignSelf: 'stretch',
    flexShrink: 0,
    paddingHorizontal: 6,
    paddingTop: 4,
    paddingBottom: 5,
    gap: 3,
    alignItems: 'stretch',
  },
  symbolParticipantTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: GinitTheme.colors.border,
    overflow: 'hidden',
  },
  symbolParticipantFill: {
    height: '100%',
    borderRadius: 999,
  },
  symbolParticipantCaption: {
    fontSize: 9,
    fontWeight: '800',
    color: GinitTheme.colors.textMuted,
    textAlign: 'center',
    letterSpacing: -0.1,
  },
  mainCol: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    minWidth: 0,
  },
  heroTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: GinitTheme.typography.title.fontSize,
    fontWeight: GinitTheme.typography.title.fontWeight,
    letterSpacing: GinitTheme.typography.title.letterSpacing,
    color: GinitTheme.colors.text,
  },
  cornerBadges: {
    flexShrink: 0,
    alignItems: 'flex-end',
    gap: 4,
    maxWidth: 104,
  },
  statusBadgeBase: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 104,
  },
  statusBadgeTomorrow: {
    backgroundColor: GinitTheme.colors.accent2,
    borderColor: GinitTheme.colors.border,
  },
  statusBadgeConfirmed: {
    backgroundColor: GinitTheme.colors.primary,
    borderColor: GinitTheme.colors.primary,
  },
  statusBadgeCoordinating: {
    backgroundColor: GinitTheme.colors.primarySoft,
    borderColor: GinitTheme.colors.border,
  },
  statusBadgeTextBase: {
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'right',
  },
  statusBadgeTextDark: {
    color: GinitTheme.colors.text,
  },
  statusBadgeTextPrimary: {
    color: GinitTheme.colors.primary,
  },
  statusBadgeTextOnPrimary: {
    color: GinitTheme.colors.textOnDark,
  },
  progressBadge: {
    flexShrink: 0,
    maxWidth: 104,
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
  metaChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaDdayChip: {
    backgroundColor: GinitTheme.colors.accent2,
    borderColor: GinitTheme.colors.border,
  },
  metaDdayChipText: {
    color: GinitTheme.colors.text,
    fontWeight: '800',
  },
  metaChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: GinitTheme.colors.bgAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    maxWidth: '100%',
  },
  metaChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: GinitTheme.colors.textSub,
  },
  condScrollView: {
    flexGrow: 0,
    maxHeight: 22,
    marginTop: -1,
  },
  condChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingRight: 2,
  },
  condChip: {
    flexShrink: 0,
    maxWidth: 112,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: GinitTheme.colors.bgAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  condChipText: {
    fontSize: 10,
    fontWeight: '800',
    color: GinitTheme.colors.textSub,
    letterSpacing: -0.15,
  },
  distRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    minHeight: 0,
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
});
