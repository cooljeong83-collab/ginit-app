import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import {
    getHomeCategoryVisual,
    homeCategoryMarkerIconColor,
    homeMeetingStatusBadgeLabel,
} from '@/src/lib/feed-home-visual';
import type { FeedMeetingSymbolBox } from '@/src/lib/feed-meeting-utils';
import { formatDistanceForList, meetingDistanceMetersFromUser, type LatLng } from '@/src/lib/geo-distance';
import { GINIT_HIGH_TRUST_HOST_MIN, isHighTrustPublicMeeting } from '@/src/lib/ginit-trust';
import {
    formatPublicMeetingAgeSummary,
    MEETING_CAPACITY_UNLIMITED,
    meetingCategoryDisplayLabel,
    meetingParticipantCount,
    meetingPrimaryStartMs,
    parsePublicMeetingDetailsConfig,
    type Meeting,
    type PublicMeetingDetailsConfig,
    type PublicMeetingGenderRatio,
    type PublicMeetingHostGenderSnapshot,
} from '@/src/lib/meetings';

const THUMB_SIZE = 70;
const THUMB_RADIUS = 10;

function settlementCornerLabel(cfg: PublicMeetingDetailsConfig): string {
  switch (cfg.settlement) {
    case 'HOST_PAYS':
      return '호스트 부담';
    case 'INDIVIDUAL':
      return '개별 정산';
    case 'MEMBERSHIP_FEE':
      return typeof cfg.membershipFeeWon === 'number' && cfg.membershipFeeWon > 0
        ? `회비 ${cfg.membershipFeeWon.toLocaleString('ko-KR')}원`
        : '회비';
    case 'DUTCH':
    default:
      return 'N분할';
  }
}

function formatMeetingScheduleLine(m: Meeting): string {
  const date = m.scheduleDate?.trim() ?? '';
  const time = m.scheduleTime?.trim() ?? '';
  if (date && time) return `${date} ${time}`;
  if (date) return date;
  if (time) return time;
  const ms = meetingPrimaryStartMs(m);
  if (ms != null) {
    return new Intl.DateTimeFormat('ko-KR', {
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(ms));
  }
  return '';
}

function capacityFillRatio(m: Meeting): number {
  const n = meetingParticipantCount(m);
  const cap = m.capacity ?? 0;
  if (!cap || cap >= MEETING_CAPACITY_UNLIMITED) return 1;
  const r = n / cap;
  if (!Number.isFinite(r)) return 0;
  return Math.max(0, Math.min(1, r));
}

function approvalChipParts(a: PublicMeetingDetailsConfig['approvalType']): {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
} {
  return a === 'HOST_APPROVAL'
    ? { icon: 'shield-checkmark-outline', label: '승인제' }
    : { icon: 'flash-outline', label: '즉시' };
}

/** 대상 성별 — 남·녀 심볼만 (`compact`: 메타 줄 우측). 동성만은 `hostGenderSnapshot`으로 주최자 성별 표시 */
function GenderSymbolVisual({
  ratio,
  compact,
  hostGenderSnapshot,
}: {
  ratio: PublicMeetingGenderRatio;
  compact?: boolean;
  hostGenderSnapshot?: PublicMeetingHostGenderSnapshot | null;
}) {
  const male = GinitTheme.colors.primary;
  const female = GinitTheme.colors.textSub;
  const muted = GinitTheme.colors.textMuted;
  const sm = compact ? 13 : 16;
  const md = compact ? 14 : 18;
  const pairGap = compact ? 3 : 5;

  if (ratio === 'HALF_HALF') {
    return (
      <View style={s.genderRow} accessibilityLabel="남녀 반반">
        <View style={[s.genderIconPair, { gap: pairGap }]}>
          <Ionicons name="male" size={sm} color={male} />
          {!compact ? <View style={s.genderDot} /> : <View style={s.genderDotCompact} />}
          <Ionicons name="female" size={sm} color={female} />
        </View>
      </View>
    );
  }
  if (ratio === 'SAME_GENDER_ONLY') {
    const host = hostGenderSnapshot ?? null;
    if (host === 'male') {
      return (
        <View style={s.genderRow} accessibilityLabel="남성 동성 모집">
          <Ionicons name="male" size={compact ? 14 : 17} color={male} />
        </View>
      );
    }
    if (host === 'female') {
      return (
        <View style={s.genderRow} accessibilityLabel="여성 동성 모집">
          <Ionicons name="female" size={compact ? 14 : 17} color={female} />
        </View>
      );
    }
    return (
      <View style={s.genderRow} accessibilityLabel="동성만">
        <Ionicons name="people" size={sm} color={GinitTheme.colors.primary} />
      </View>
    );
  }
  return (
    <View style={s.genderRow} accessibilityLabel="성별 제한 없음">
      <Ionicons name="male-female-outline" size={md} color={muted} />
    </View>
  );
}

type Props = {
  meeting: Meeting;
  userCoords: LatLng | null;
  joined: boolean;
  ownership?: 'hosted' | 'joined' | 'none';
  onPress: () => void;
  scheduleOverlapWarning?: boolean;
  symbolBox?: FeedMeetingSymbolBox | null;
  categories?: readonly { id: string; label: string }[] | null;
};

/**
 * 홈(모임 탭) 모임 리스트 행 — 카드 없이 연속 리스트 + 상위 FlatList 디바이더로 구분.
 * 제목 / 일정 / 위치·조건 / 모집 조건 을 모듈 단위로 쌓아 가독성을 맞춤.
 */
export function HomeMeetingListItem({
  meeting: m,
  userCoords,
  joined,
  ownership = 'none',
  onPress,
  scheduleOverlapWarning = false,
  symbolBox = null,
  categories = null,
}: Props) {
  const visual = useMemo(() => getHomeCategoryVisual(m), [m]);
  const statusCorner = useMemo(() => homeMeetingStatusBadgeLabel(m), [m]);
  const iconColor = useMemo(() => homeCategoryMarkerIconColor(visual.gradient), [visual.gradient]);
  const scheduleLine = useMemo(() => formatMeetingScheduleLine(m), [m]);
  const capFill = useMemo(() => capacityFillRatio(m), [m]);
  const showCapacityBar = useMemo(() => {
    const cap = m.capacity ?? 0;
    return Boolean(cap && cap < MEETING_CAPACITY_UNLIMITED);
  }, [m.capacity]);
  const cfg = useMemo(
    () => (m.isPublic === true ? parsePublicMeetingDetailsConfig(m.meetingConfig) : null),
    [m.isPublic, m.meetingConfig],
  );

  const distanceLine = useMemo(
    () => formatDistanceForList(meetingDistanceMetersFromUser(m, userCoords)),
    [m, userCoords],
  );

  const ageMeta = cfg ? formatPublicMeetingAgeSummary(cfg.ageLimit) : '';
  const trustMin = useMemo(() => {
    if (!cfg || typeof cfg.minGTrust !== 'number' || !Number.isFinite(cfg.minGTrust)) return null;
    const hostMin = Math.trunc(cfg.minGTrust);
    return isHighTrustPublicMeeting(cfg) ? Math.max(GINIT_HIGH_TRUST_HOST_MIN, hostMin) : hostMin;
  }, [cfg]);

  const approvalParts = useMemo(() => (cfg ? approvalChipParts(cfg.approvalType) : null), [cfg]);

  const symbolAccessibilityLabel =
    symbolBox?.source === 'movie_poster'
      ? '영화 포스터'
      : symbolBox?.source === 'host_profile'
        ? '주관자 프로필'
        : meetingCategoryDisplayLabel(m, categories ?? undefined)?.trim() || '모임';

  const categoryTitlePrefix = useMemo(
    () => meetingCategoryDisplayLabel(m, categories ?? undefined)?.trim() ?? '',
    [m, categories],
  );

  const whereText = useMemo(() => [distanceLine, ageMeta || null].filter(Boolean).join(' · '), [distanceLine, ageMeta]);

  const rulesLinePublic = useMemo(() => {
    if (!cfg || m.isPublic !== true) return '';
    const bits: string[] = [];
    if (ownership === 'hosted') bits.push('Host');
    else if (ownership === 'joined') bits.push('Guest');
    bits.push(settlementCornerLabel(cfg));
    bits.push(`Lv.${cfg.minGLevel}+`);
    if (trustMin != null) bits.push(`신뢰≥${trustMin}`);
    if (approvalParts) bits.push(approvalParts.label);
    return bits.join(' · ');
  }, [cfg, m.isPublic, ownership, trustMin, approvalParts]);

  const rulesLinePrivate = useMemo(() => {
    const bits: string[] = [];
    if (ownership === 'hosted') bits.push('Host');
    else if (ownership === 'joined') bits.push('Guest');
    bits.push('비공개');
    return bits.join(' · ');
  }, [ownership]);

  const statusStyle = useMemo(() => {
    if (statusCorner === '일정 확정') return s.statusConfirmed;
    if (statusCorner === '모집 중') return s.statusOpen;
    return s.statusDefault;
  }, [statusCorner]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint="모임 상세로 이동"
      accessibilityState={{ selected: joined }}
      style={({ pressed }) => [s.pressableRow, pressed && s.pressablePressed]}>
      <View style={s.row}>
        <View style={s.lead}>
          <View style={s.symbolRing} accessibilityLabel={symbolAccessibilityLabel}>
            {!symbolBox ? <View style={[s.symbolTint, { backgroundColor: visual.gradient[0] }]} /> : null}
            {symbolBox ? (
              <Image
                source={{ uri: symbolBox.url }}
                style={s.symbolPhoto}
                contentFit="cover"
                transition={140}
                cachePolicy="disk"
                recyclingKey={symbolBox.url}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <Ionicons name={visual.icon} size={34} color={iconColor} style={s.symbolIcon} />
            )}
          </View>
          {showCapacityBar ? (
            <>
              <View style={s.capRow}>
                <View
                  style={s.capTrack}
                  accessibilityLabel={`참여 인원 ${meetingParticipantCount(m)}명, 최대 ${m.capacity}명`}>
                  <View style={[s.capFill, { width: `${Math.round(capFill * 100)}%` }]} />
                </View>
                <Text style={s.capLabel} numberOfLines={1}>
                  {`${meetingParticipantCount(m)}/${m.capacity}`}
                </Text>
              </View>
            </>
          ) : null}
        </View>

        <View style={s.main}>
          {scheduleOverlapWarning ? (
            <Text style={s.overlapHint} numberOfLines={1}>
              시간 중복 주의
            </Text>
          ) : null}

          <View style={s.headRow}>
            <View style={s.titleCol}>
              <Text style={s.title} numberOfLines={2}>
                {categoryTitlePrefix ? <Text style={s.titleCat}>[{categoryTitlePrefix}] </Text> : null}
                {m.title}
              </Text>
            </View>
            <Text style={[s.status, statusStyle]} numberOfLines={2}>
              {statusCorner}
            </Text>
          </View>

          {scheduleLine ? (
            <Text style={s.moduleWhen} numberOfLines={1}>
              {scheduleLine}
            </Text>
          ) : null}

          {whereText.length > 0 || (m.isPublic === true && cfg) ? (
            <View
              style={[s.moduleWhereRow, whereText.length === 0 && m.isPublic === true && cfg && s.moduleWhereRowEnd]}>
              {whereText.length > 0 ? (
                <Text style={s.moduleWhereText} numberOfLines={1}>
                  {whereText}
                </Text>
              ) : null}
              {m.isPublic === true && cfg ? (
                <View style={s.genderInline}>
                  <GenderSymbolVisual ratio={cfg.genderRatio} hostGenderSnapshot={cfg.hostGenderSnapshot} compact />
                </View>
              ) : null}
            </View>
          ) : null}

          {m.isPublic === true && cfg ? (
            <Text style={s.moduleRules} numberOfLines={2}>
              {rulesLinePublic}
            </Text>
          ) : m.isPublic === false ? (
            <Text style={s.moduleRules} numberOfLines={2}>
              {rulesLinePrivate}
            </Text>
          ) : m.isPublic === true && !cfg ? (
            <Text style={s.moduleRulesMuted} numberOfLines={1}>
              공개 조건을 불러올 수 없어요
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  pressableRow: {
    paddingVertical: 10,
  },
  pressablePressed: {
    opacity: 0.86,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  lead: {
    width: THUMB_SIZE,
    flexShrink: 0,
    alignItems: 'center',
    gap: 3,
    paddingTop: 1,
  },
  symbolRing: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_RADIUS,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GinitTheme.colors.bgAlt,
  },
  symbolTint: {
    ...StyleSheet.absoluteFillObject,
  },
  symbolIcon: {
    zIndex: 1,
  },
  symbolPhoto: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: THUMB_RADIUS - 1,
    zIndex: 2,
  },
  capRow: {
    width: THUMB_SIZE,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -1,
  },
  capTrack: {
    flex: 1,
    height: 3,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: GinitTheme.colors.border,
    alignSelf: 'center',
  },
  capFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: GinitTheme.colors.primary,
  },
  capLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    letterSpacing: -0.35,
    maxWidth: 40,
    textAlign: 'center',
  },
  main: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  overlapHint: {
    fontSize: 10,
    fontWeight: '600',
    color: GinitTheme.colors.warning,
    letterSpacing: -0.15,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  titleCol: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
    lineHeight: 18,
    color: GinitTheme.colors.text,
  },
  titleCat: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.15,
    color: GinitTheme.colors.textSub,
  },
  status: {
    flexShrink: 0,
    maxWidth: '34%',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: -0.12,
    textAlign: 'right',
    lineHeight: 14,
  },
  statusDefault: {
    color: GinitTheme.colors.textMuted,
  },
  statusOpen: {
    color: GinitTheme.colors.textSub,
  },
  statusConfirmed: {
    color: GinitTheme.colors.primary,
  },
  moduleWhen: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.textSub,
    letterSpacing: -0.2,
    lineHeight: 15,
  },
  moduleWhereRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  moduleWhereRowEnd: {
    justifyContent: 'flex-end',
  },
  moduleWhereText: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    letterSpacing: -0.12,
  },
  genderInline: {
    flexShrink: 0,
  },
  moduleRules: {
    fontSize: 11,
    fontWeight: '700',
    color: GinitTheme.colors.textSub,
    letterSpacing: -0.1,
    lineHeight: 15,
  },
  moduleRulesMuted: {
    fontSize: 11,
    fontWeight: '700',
    color: GinitTheme.colors.textMuted,
    letterSpacing: -0.1,
  },
  genderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  genderIconPair: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  genderDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: GinitTheme.colors.borderStrong,
  },
  genderDotCompact: {
    width: 2,
    height: 2,
    borderRadius: 1,
    marginHorizontal: 1,
    backgroundColor: GinitTheme.colors.borderStrong,
  },
});
