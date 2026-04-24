import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { GinitTheme } from '@/constants/ginit-theme';
import { formatDistanceForList, meetingDistanceMetersFromUser, type LatLng } from '@/src/lib/geo-distance';
import { getHomeCategoryVisual, homeMeetingStatusBadgeLabel } from '@/src/lib/feed-home-visual';
import { GINIT_HIGH_TRUST_HOST_MIN, isHighTrustPublicMeeting } from '@/src/lib/ginit-trust';
import type {
  Meeting,
  PublicMeetingDetailsConfig,
  PublicMeetingGenderRatio,
  PublicMeetingHostGenderSnapshot,
} from '@/src/lib/meetings';
import type { FeedMeetingSymbolBox } from '@/src/lib/feed-meeting-utils';
import {
  formatPublicMeetingAgeSummary,
  MEETING_CAPACITY_UNLIMITED,
  meetingParticipantCount,
  meetingPrimaryStartMs,
  parsePublicMeetingDetailsConfig,
} from '@/src/lib/meetings';

const AnimatedView = Animated.createAnimatedComponent(View);

function rgbaFromCssColor(c: string): { r: number; g: number; b: number; a: number } | null {
  const s = (c ?? '').trim();
  if (!s) return null;
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      if ([r, g, b].every(Number.isFinite)) return { r, g, b, a: 1 };
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if ([r, g, b].every(Number.isFinite)) return { r, g, b, a: 1 };
    }
    return null;
  }
  const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (!m) return null;
  const r = Math.max(0, Math.min(255, Math.round(Number(m[1]))));
  const g = Math.max(0, Math.min(255, Math.round(Number(m[2]))));
  const b = Math.max(0, Math.min(255, Math.round(Number(m[3]))));
  if (![r, g, b].every(Number.isFinite)) return null;
  const aRaw = m[4] == null ? 1 : Number(m[4]);
  const a = Number.isFinite(aRaw) ? Math.max(0, Math.min(1, aRaw)) : 1;
  return { r, g, b, a };
}

function blendOverWhite(rgb: { r: number; g: number; b: number; a: number }): { r: number; g: number; b: number } {
  // 실제 UI에서 그라데이션은 흰 글래스 위에 깔리므로, 대비 계산은 흰색 배경으로 블렌딩합니다.
  const a = Math.max(0, Math.min(1, rgb.a));
  return {
    r: Math.round(rgb.r * a + 255 * (1 - a)),
    g: Math.round(rgb.g * a + 255 * (1 - a)),
    b: Math.round(rgb.b * a + 255 * (1 - a)),
  };
}

function luminance01(rgb: { r: number; g: number; b: number }): number {
  // sRGB relative luminance (gamma-corrected). Output 0..1
  const toLinear = (x: number) => {
    const v = x / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastIconColorFromGradient(gradient: readonly [string, string]): string {
  const a = rgbaFromCssColor(gradient[0]);
  const b = rgbaFromCssColor(gradient[1]);
  const avgRgba =
    a && b
      ? { r: (a.r + b.r) / 2, g: (a.g + b.g) / 2, b: (a.b + b.b) / 2, a: (a.a + b.a) / 2 }
      : a ?? b;
  if (!avgRgba) return '#FFFFFF';
  const blended = blendOverWhite(avgRgba);
  const L = luminance01(blended);
  return L >= 0.62 ? '#0b1220' : '#FFFFFF';
}

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

/** 대상 성별 — 남·녀 심볼만 (`compact`: 메타 줄 우측 캡슐용 작은 크기). 동성만은 `hostGenderSnapshot`으로 주최자 성별 표시 */
function GenderSymbolVisual({
  ratio,
  compact,
  hostGenderSnapshot,
}: {
  ratio: PublicMeetingGenderRatio;
  compact?: boolean;
  hostGenderSnapshot?: PublicMeetingHostGenderSnapshot | null;
}) {
  /** `PublicMeetingDetailsCard` 칩·세그먼트와 동일 톤: primary / textSub / muted */
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

function NeonHeadBadge({ statusLine, pulse }: { statusLine: string; pulse: boolean }) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (pulse) {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.03, { duration: 820, easing: Easing.inOut(Easing.sin) }),
          withTiming(1, { duration: 820, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      );
    } else {
      cancelAnimation(scale);
      scale.value = withTiming(1, { duration: 160 });
    }
  }, [pulse, scale]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedView style={[s.neonBadgeOuter, pulse && s.neonBadgePulseWrap, pulseStyle]}>
      <View style={s.neonBadgeInner}>
        <Text style={s.neonBadgeStatus} numberOfLines={2}>
          {statusLine}
        </Text>
      </View>
    </AnimatedView>
  );
}

const OVERLAP_NEON = '#FF8A00';

function OverlapScheduleNeonBadge() {
  return (
    <View style={s.overlapNeonOuter}>
      <View style={s.overlapNeonInner}>
        <Text style={s.overlapNeonText} numberOfLines={1}>
          시간 중복 주의
        </Text>
      </View>
    </View>
  );
}

type Props = {
  meeting: Meeting;
  userCoords: LatLng | null;
  joined: boolean;
  onPress: () => void;
  /** 내 확정 일정과 ±버퍼 이내 겹침(피드 안내) */
  scheduleOverlapWarning?: boolean;
  /** 영화 포스터 또는 주관자 프로필 — 없으면 카테고리 아이콘 */
  symbolBox?: FeedMeetingSymbolBox | null;
};

/**
 * 홈 모임 리스트 카드 — 모임 생성(`VoteCandidateCard`/wizard)과 동일한 밝은 글래스·보더 패턴,
 * 정산 칩을 자격 칩열 최앞, 성별은 거리·연령 메타 줄 우측 캡슐(심볼만).
 */
export function HomeMeetingListItem({
  meeting: m,
  userCoords,
  joined,
  onPress,
  scheduleOverlapWarning = false,
  symbolBox = null,
}: Props) {
  const visual = useMemo(() => getHomeCategoryVisual(m), [m]);
  const statusCorner = useMemo(() => homeMeetingStatusBadgeLabel(m), [m]);
  const iconColor = useMemo(() => contrastIconColorFromGradient(visual.gradient), [visual.gradient]);
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

  /** 일정·장소 조율 단계(모집 중)일 때만 미세 펄스 */
  const pulseCoordinating = statusCorner === '모집 중';
  const approvalParts = cfg ? approvalChipParts(cfg.approvalType) : null;

  const symbolAccessibilityLabel =
    symbolBox?.source === 'movie_poster'
      ? '영화 포스터'
      : symbolBox?.source === 'host_profile'
        ? '주관자 프로필'
        : m.categoryLabel?.trim() || '모임';

  return (
    <View style={s.meetRowWrap}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityHint="모임 상세로 이동"
        accessibilityState={{ selected: joined }}
        style={s.pressable}>
        <View style={[s.cardShadow, joined && s.cardShadowJoined]}>
          <View style={s.cardShell}>
            <LinearGradient
              colors={[...visual.gradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={s.accentStripe}
            />
            <View style={[s.cardInner, joined && s.cardInnerJoined]}>
              <View style={s.zoneA}>
                <View style={s.symbolCol}>
                  <View style={s.categoryIconBubble} accessibilityLabel={symbolAccessibilityLabel}>
                    <LinearGradient
                      colors={[...visual.gradient]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 0, y: 1 }}
                      style={StyleSheet.absoluteFillObject}
                    />
                    {symbolBox ? (
                      <Image
                        source={{ uri: symbolBox.url }}
                        style={s.categoryIconPhoto}
                        contentFit="cover"
                        transition={140}
                        accessibilityIgnoresInvertColors
                      />
                    ) : (
                      <Ionicons name={visual.icon} size={15} color={iconColor} style={s.categoryIconFg} />
                    )}
                  </View>
                  {showCapacityBar ? (
                    <>
                      <View
                        style={s.capacitySymbolTrack}
                        accessibilityLabel={`참여 인원 ${meetingParticipantCount(m)}명, 최대 ${m.capacity}명`}>
                        <View style={[s.capacityFill, { width: `${Math.round(capFill * 100)}%` }]} />
                      </View>
                      <Text style={s.capacityCountLabel} numberOfLines={1}>
                        {`${meetingParticipantCount(m)}/${m.capacity}`}
                      </Text>
                    </>
                  ) : null}
                </View>
                <View style={s.zoneAMain}>
                  <View style={s.titleScheduleStack}>
                    <View style={s.titleRow}>
                      <Text style={s.heroTitle} numberOfLines={1} ellipsizeMode="tail">
                        {m.title}
                      </Text>
                      <View style={s.zoneARightCol}>
                        <NeonHeadBadge statusLine={statusCorner} pulse={pulseCoordinating} />
                        {scheduleOverlapWarning ? <OverlapScheduleNeonBadge /> : null}
                      </View>
                    </View>
                    {scheduleLine ? (
                      <Text style={s.scheduleLine} numberOfLines={1} ellipsizeMode="tail">
                        {scheduleLine}
                      </Text>
                    ) : null}
                  </View>
                  {m.isPublic === true && cfg ? (
                    <>
                      <View style={s.metaRow}>
                        <Text style={[s.metaMuted, s.metaTextFlex]} numberOfLines={1} ellipsizeMode="tail">
                          {[distanceLine, ageMeta ? ageMeta : null].filter(Boolean).join(' · ')}
                        </Text>
                        <View style={s.genderDock}>
                          <GenderSymbolVisual
                            ratio={cfg.genderRatio}
                            hostGenderSnapshot={cfg.hostGenderSnapshot}
                            compact
                          />
                        </View>
                      </View>
                    </>
                  ) : (
                    <Text style={s.metaMuted} numberOfLines={1}>
                      {[distanceLine, m.isPublic === true && ageMeta ? ageMeta : null].filter(Boolean).join(' · ')}
                    </Text>
                  )}
                </View>
              </View>

              {m.isPublic === false ? (
                <View style={s.privateRow}>
                  <View style={s.infoChip}>
                    <Ionicons name="lock-closed-outline" size={13} color={GinitTheme.colors.textSub} />
                    <Text style={s.infoChipText}>비공개</Text>
                  </View>
                </View>
              ) : cfg ? (
                <>
                  <View style={s.zoneB}>
                    <View style={[s.infoChip, s.settlementChipShrink]}>
                      <Ionicons name="wallet-outline" size={13} color={GinitTheme.colors.primary} />
                      <Text style={[s.infoChipTextStrong, s.chipLabelMax]} numberOfLines={1}>
                        {settlementCornerLabel(cfg)}
                      </Text>
                    </View>
                    <View style={s.infoChip}>
                      <Ionicons name="trending-up-outline" size={13} color={GinitTheme.colors.primary} />
                      <Text style={s.infoChipTextStrong}>Lv.{cfg.minGLevel}+</Text>
                    </View>
                    {trustMin != null ? (
                      <View style={s.infoChip}>
                        <Ionicons name="ribbon-outline" size={13} color={GinitTheme.colors.primary} />
                        <Text style={s.infoChipTextStrong}>신뢰≥{trustMin}</Text>
                      </View>
                    ) : null}
                    {approvalParts ? (
                      <View style={s.infoChip}>
                        <Ionicons name={approvalParts.icon} size={13} color={GinitTheme.colors.primary} />
                        <Text style={s.infoChipTextStrong}>{approvalParts.label}</Text>
                      </View>
                    ) : null}
                  </View>
                </>
              ) : (
                <Text style={s.fallbackMeta} numberOfLines={1}>
                  공개 조건을 불러올 수 없어요
                </Text>
              )}
            </View>
          </View>
        </View>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  meetRowWrap: {
    marginBottom: 10,
    borderRadius: GinitTheme.radius.card,
    backgroundColor: Platform.OS === 'android' ? GinitTheme.colors.surfaceStrong : 'transparent',
    ...GinitTheme.shadow.card,
  },
  pressable: {
    borderRadius: GinitTheme.radius.card,
    overflow: 'hidden',
  },
  cardShadow: {
    borderRadius: GinitTheme.radius.card,
    backgroundColor: GinitTheme.colors.surface,
  },
  /** 참여 중인 모임 — 선택된 카드처럼 은은한 하이라이트 */
  cardShadowJoined: {
    backgroundColor: GinitTheme.colors.bgAlt,
  },
  cardShell: {
    borderRadius: GinitTheme.radius.card,
    overflow: 'hidden',
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    alignSelf: 'stretch',
  },
  accentStripe: {
    width: 4,
    alignSelf: 'stretch',
  },
  cardInner: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 10,
    paddingHorizontal: 12,
    paddingLeft: 10,
    gap: 6,
    backgroundColor: GinitTheme.glassModal.inputFill,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: GinitTheme.colors.border,
  },
  cardInnerJoined: {
    backgroundColor: GinitTheme.colors.primarySoft,
  },
  zoneA: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  /** 카테고리 심볼 + 참여중 — 세로 스택(열 너비는 아이콘·pill 중 넓은 쪽), 아이콘은 가로 가운데 */
  symbolCol: {
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    paddingTop: 1,
  },
  zoneAMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  /** 타이틀 ↔ 일시만 촘촘히; 아래 메타와는 zoneAMain gap 유지 */
  titleScheduleStack: {
    minWidth: 0,
    gap: 1,
  },
  zoneARightCol: {
    flexShrink: 0,
    maxWidth: '44%',
    alignItems: 'flex-end',
    paddingTop: 1,
    gap: 6,
  },
  overlapNeonOuter: {
    alignSelf: 'flex-end',
    shadowColor: 'rgba(255, 138, 0, 0.55)',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 3,
  },
  overlapNeonInner: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 138, 0, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 138, 0, 0.55)',
    alignItems: 'flex-end',
  },
  overlapNeonText: {
    fontSize: 10,
    fontWeight: '900',
    color: OVERLAP_NEON,
    letterSpacing: -0.2,
    textAlign: 'right',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    minWidth: 0,
  },
  categoryIconBubble: {
    width: 32,
    height: 32,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    backgroundColor: GinitTheme.colors.surfaceStrong,
  },
  categoryIconFg: {
    zIndex: 1,
  },
  categoryIconPhoto: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 9,
    zIndex: 2,
  },
  heroTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.2,
    lineHeight: 18,
    color: GinitTheme.colors.text,
  },
  scheduleLine: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1e293b',
    letterSpacing: -0.2,
    lineHeight: 15,
  },
  /** 좌측 심볼(32) 아래 — 참여 인원 미니 막대 */
  capacitySymbolTrack: {
    width: 32,
    height: 3,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(15, 23, 42, 0.10)',
    alignSelf: 'center',
  },
  capacityFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: GinitTheme.colors.primary,
  },
  /** 막대 아래: 참여 인원 / 최대 인원 */
  capacityCountLabel: {
    marginTop: 3,
    fontSize: 9,
    fontWeight: '800',
    color: GinitTheme.colors.textMuted,
    letterSpacing: -0.35,
    alignSelf: 'center',
    maxWidth: 40,
    textAlign: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 1,
  },
  metaTextFlex: {
    flex: 1,
    minWidth: 0,
  },
  metaMuted: {
    fontSize: 11,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    letterSpacing: -0.12,
  },
  genderDock: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
    paddingHorizontal: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  neonBadgeOuter: {
    alignSelf: 'flex-end',
  },
  neonBadgePulseWrap: {
    shadowColor: 'rgba(134, 211, 183, 0.45)',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 3,
  },
  neonBadgeInner: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(134, 211, 183, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(134, 211, 183, 0.45)',
    alignItems: 'flex-end',
  },
  neonBadgeStatus: {
    fontSize: 10,
    fontWeight: '900',
    color: GinitTheme.colors.textSub,
    letterSpacing: -0.2,
    textAlign: 'right',
  },
  privateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  zoneB: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
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
  infoChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
  },
  infoChipText: {
    fontSize: 10,
    fontWeight: '800',
    color: GinitTheme.colors.textSub,
    letterSpacing: -0.12,
  },
  infoChipTextStrong: {
    fontSize: 10,
    fontWeight: '900',
    color: GinitTheme.colors.primary,
    letterSpacing: -0.12,
  },
  settlementChipShrink: {
    flexShrink: 0,
    maxWidth: '100%',
  },
  chipLabelMax: {
    flexShrink: 1,
    maxWidth: 120,
  },
  fallbackMeta: {
    fontSize: 11,
    fontWeight: '700',
    color: GinitTheme.colors.textMuted,
  },
});
