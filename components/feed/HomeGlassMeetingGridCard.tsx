import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { homeBlurIntensity, shouldUseStaticGlassInsteadOfBlur } from '@/constants/home-glass-styles';
import { getHomeCategoryVisual, HOME_ORANGE, HOME_TRUST_BLUE, homeMeetingStatusBadgeLabel } from '@/src/lib/feed-home-visual';
import { formatDistanceForList, meetingDistanceMetersFromUser, type LatLng } from '@/src/lib/geo-distance';
import type { Meeting } from '@/src/lib/meetings';
import { MEETING_CAPACITY_UNLIMITED, meetingParticipantCount } from '@/src/lib/meetings';

const AnimatedView = Animated.createAnimatedComponent(View);

type Layout = 'grid' | 'strip';

type Props = {
  meeting: Meeting;
  onPress: () => void;
  userCoords?: LatLng | null;
  /** 기본 grid — 상단 가로 스트립은 strip */
  layout?: Layout;
  /** Pretendard Bold 로드 후 `PretendardBold` */
  titleFontFamily?: string;
};

function capacitySummaryLine(m: Meeting): string {
  const n = meetingParticipantCount(m);
  const cap = m.capacity ?? 0;
  if (!cap || cap >= MEETING_CAPACITY_UNLIMITED) return `${n}명 참여`;
  return `${n}/${cap}명`;
}

function glowAccentForMeeting(id: string): 'blue' | 'orange' {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 2 === 0 ? 'blue' : 'orange';
}

export function HomeGlassMeetingGridCard({
  meeting: m,
  onPress,
  userCoords = null,
  layout = 'grid',
  titleFontFamily,
}: Props) {
  const visual = useMemo(() => getHomeCategoryVisual(m), [m]);
  const badgeLabel = useMemo(() => homeMeetingStatusBadgeLabel(m), [m]);
  const distLine = useMemo(
    () => formatDistanceForList(meetingDistanceMetersFromUser(m, userCoords)),
    [m, userCoords],
  );

  const isStrip = layout === 'strip';
  const metaLine = useMemo(() => capacitySummaryLine(m), [m]);

  const glowAccent = glowAccentForMeeting(m.id);
  const pressed = useSharedValue(0);

  const neonStyle = useAnimatedStyle(() => {
    const active = pressed.value;
    const neon = glowAccent === 'blue' ? HOME_TRUST_BLUE : HOME_ORANGE;
    return {
      borderColor: active > 0.35 ? neon : 'rgba(255, 255, 255, 0.58)',
      shadowColor: active > 0.35 ? neon : 'rgba(8, 15, 35, 0.65)',
      shadowOpacity: 0.14 + active * 0.42,
      shadowRadius: 12 + active * 18,
      shadowOffset: { width: 0, height: 6 + active * 4 },
      elevation: 4 + Math.round(active * 4),
    };
  }, [glowAccent]);

  const titleSize = isStrip ? 13 : 15;
  const metaSize = isStrip ? 10 : 11;

  const titleFont = titleFontFamily ? { fontFamily: titleFontFamily } : { fontWeight: '700' as const };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        pressed.value = withTiming(1, { duration: 120 });
      }}
      onPressOut={() => {
        pressed.value = withTiming(0, { duration: 180 });
      }}
      accessibilityRole="button"
      accessibilityLabel={`${m.title}, ${badgeLabel}`}
      style={isStrip ? styles.stripPressWrap : styles.gridPressWrap}>
      <AnimatedView style={[isStrip ? styles.cardStrip : styles.cardGrid, neonStyle]}>
        <LinearGradient colors={[...visual.gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFillObject} />

        {shouldUseStaticGlassInsteadOfBlur() ? (
          <View style={[StyleSheet.absoluteFillObject, styles.staticGlass]} />
        ) : (
          <BlurView
            intensity={Platform.OS === 'ios' ? 52 : homeBlurIntensity}
            tint="light"
            style={StyleSheet.absoluteFillObject}
            experimentalBlurMethod={Platform.OS === 'ios' ? 'dimezisBlurView' : undefined}
          />
        )}
        <View style={styles.veil} pointerEvents="none" />

        <View style={[styles.badgeNeon, isStrip && styles.badgeNeonStrip]} pointerEvents="none">
          <Text style={styles.badgeNeonText} numberOfLines={1}>
            {badgeLabel}
          </Text>
        </View>

        <View style={[styles.body, isStrip && styles.bodyStrip]}>
          <View style={styles.titleBlock}>
            <Text
              style={[
                styles.title,
                titleFont,
                { fontSize: titleSize, lineHeight: titleSize + 4 },
                isStrip && styles.titleStrip,
              ]}
              numberOfLines={isStrip ? 2 : 2}>
              {m.title}
            </Text>
            <Text style={[styles.distance, { fontSize: metaSize }]} numberOfLines={1}>
              {distLine}
            </Text>
            {m.categoryLabel ? (
              <Text style={[styles.category, { fontSize: metaSize - 1 }]} numberOfLines={1}>
                {m.categoryLabel}
              </Text>
            ) : null}
          </View>

          <Text style={[styles.footerMeta, { fontSize: metaSize }]} numberOfLines={1}>
            {metaLine}
          </Text>
        </View>
      </AnimatedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gridPressWrap: {
    flex: 1,
    minWidth: 0,
  },
  stripPressWrap: {
    width: 174,
    flexShrink: 0,
  },
  cardGrid: {
    borderRadius: 22,
    overflow: 'hidden',
    minHeight: 156,
    borderWidth: 1,
    marginBottom: 12,
  },
  cardStrip: {
    borderRadius: 22,
    overflow: 'hidden',
    minHeight: 112,
    borderWidth: 1,
    marginBottom: 0,
  },
  staticGlass: {
    backgroundColor: 'rgba(255, 255, 255, 0.48)',
  },
  veil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  badgeNeon: {
    position: 'absolute',
    top: 10,
    right: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 138, 0, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255, 138, 0, 0.95)',
    maxWidth: '52%',
    shadowColor: HOME_ORANGE,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 10,
    elevation: 3,
  },
  badgeNeonStrip: {
    top: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: '58%',
  },
  badgeNeonText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#7c2d12',
    letterSpacing: -0.2,
    textShadowColor: 'rgba(255, 255, 255, 0.9)',
    textShadowOffset: { width: 0, height: 0.5 },
    textShadowRadius: 2,
  },
  body: {
    flex: 1,
    padding: 14,
    paddingTop: 40,
    justifyContent: 'flex-end',
    gap: 6,
  },
  bodyStrip: {
    padding: 10,
    paddingTop: 36,
    gap: 4,
  },
  titleBlock: {
    gap: 3,
  },
  title: {
    color: '#0b1220',
    letterSpacing: -0.35,
    textShadowColor: 'rgba(255, 255, 255, 0.95)',
    textShadowOffset: { width: 0, height: 0.5 },
    textShadowRadius: 3,
  },
  titleStrip: {
    letterSpacing: -0.25,
  },
  distance: {
    fontWeight: '700',
    color: HOME_TRUST_BLUE,
    textShadowColor: 'rgba(255, 255, 255, 0.85)',
    textShadowOffset: { width: 0, height: 0.5 },
    textShadowRadius: 2,
  },
  category: {
    fontWeight: '700',
    color: '#334155',
    textShadowColor: 'rgba(255, 255, 255, 0.75)',
    textShadowOffset: { width: 0, height: 0.5 },
    textShadowRadius: 2,
  },
  footerMeta: {
    fontWeight: '800',
    color: '#0f172a',
    textShadowColor: 'rgba(255, 255, 255, 0.8)',
    textShadowOffset: { width: 0, height: 0.5 },
    textShadowRadius: 2,
  },
});
