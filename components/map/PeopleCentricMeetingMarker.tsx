
import { memo, useEffect, useMemo, useRef } from 'react';
import { Animated, Image as RNImage, Platform, StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';

import { GinitTheme } from '@/constants/ginit-theme';
import { getHomeCategoryVisual } from '@/src/lib/feed-home-visual';
import { resolveMeetingListThumbnailUri } from '@/src/lib/meeting-list-thumbnail';
import type { Meeting } from '@/src/lib/meetings';
import { getMeetingRecruitmentPhase } from '@/src/lib/meetings';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';

const AVATAR = 44;
const BORDER = 2.5;
const BADGE = 20;
const ANDROID_PAD = 6;
const ANDROID_CANVAS = AVATAR + ANDROID_PAD * 2;

function phaseBorderColor(phase: ReturnType<typeof getMeetingRecruitmentPhase>): string {
  // 요구사항: 조율 중=Energetic Orange, 확정=Trust Blue
  // 토큰 매핑: Energetic Orange → warning, Trust Blue → trustBlue(legacy) / primary
  return phase === 'confirmed' ? GinitTheme.trustBlue : GinitTheme.colors.warning;
}

type Props = {
  meeting: Meeting;
  hostPhotoUrl: string | null;
  selected: boolean;
  /** Android에서 네이버맵 커스텀 뷰 마커용: 리치 마커 강제 */
  forceRich?: boolean;
  /** 네이버 기본 마커 색상과 보더를 맞출지 */
  matchNaverMarkerBorder?: boolean;
  /** 네이버 기본 핀 위에 아바타를 얹는(삽입) 모드 */
  naverPinEmbed?: boolean;
  /** (Android/Naver) 사진+보더만 표시 */
  naverAvatarOnly?: boolean;
};

const NAVER_MARKER_GREEN = '#03C75A';
const NAVER_PIN_BOX_W = 44;
const NAVER_PIN_BOX_H = 56;
const NAVER_PIN_AVATAR = 28;
const NAVER_PIN_BORDER = 2;
const NAVER_AVATAR_ONLY = 32;
const NAVER_AVATAR_ONLY_BORDER = 2;

function PeopleCentricMeetingMarkerInner({
  meeting,
  hostPhotoUrl,
  selected,
  forceRich,
  matchNaverMarkerBorder,
  naverPinEmbed,
  naverAvatarOnly,
}: Props) {
  const phase = getMeetingRecruitmentPhase(meeting);
  const visual = useMemo(() => getHomeCategoryVisual(meeting), [meeting]);
  const borderColor = useMemo(
    () => (matchNaverMarkerBorder ? NAVER_MARKER_GREEN : phaseBorderColor(phase)),
    [matchNaverMarkerBorder, phase],
  );
  const uri = useMemo(() => {
    const u = hostPhotoUrl?.trim();
    if (u && /^https:\/\//i.test(u)) return u;
    return resolveMeetingListThumbnailUri(meeting);
  }, [hostPhotoUrl, meeting]);

  // Android에서는 react-native-maps 커스텀 마커 스냅샷이 복잡한 뷰 트리를 자주 깨뜨려서
  // “사진만” 단순하게 렌더링합니다.
  if (Platform.OS === 'android' && !forceRich) {
    return (
      <View collapsable={false} style={styles.androidHit} accessibilityLabel={meeting.title}>
        <RNImage source={{ uri }} style={styles.androidAvatar} resizeMode="cover" fadeDuration={120} />
      </View>
    );
  }

  // Android(Naver): 사진 + 보더만 (기본 핀 없이 쓰는 모드)
  if (Platform.OS === 'android' && naverAvatarOnly) {
    return (
      <View collapsable={false} style={styles.naverAvatarOnlyHit} accessibilityLabel={meeting.title}>
        <View style={[styles.naverAvatarOnlyRing, { borderColor }, selected && styles.naverPinRingSelected]}>
          <RNImage source={{ uri }} style={styles.naverAvatarOnlyAvatar} resizeMode="cover" fadeDuration={120} />
        </View>
      </View>
    );
  }

  // Android(NaverMap): 네이버 기본 핀 상단 원에 프로필 사진이 들어간 느낌
  if (Platform.OS === 'android' && naverPinEmbed) {
    return (
      <View collapsable={false} style={styles.naverPinBox} accessibilityLabel={meeting.title}>
        <View
          style={[
            styles.naverPinRing,
            { borderColor },
            selected && styles.naverPinRingSelected,
          ]}>
          <RNImage source={{ uri }} style={styles.naverPinAvatar} resizeMode="cover" fadeDuration={120} />
        </View>
      </View>
    );
  }

  const isConfirmed = phase === 'confirmed';
  const pulseEnabled = Platform.OS !== 'android';
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!pulseEnabled || !isConfirmed) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 820, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 820, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => {
      anim.stop();
    };
  }, [isConfirmed, pulse, pulseEnabled]);

  const pulseStyle = useMemo(
    () => ({
      opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.85] }),
      transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] }) }],
    }),
    [pulse],
  );

  return (
    <View collapsable={false} style={styles.hit} accessibilityLabel={meeting.title}>
      <View style={styles.avatarWrap}>
        <View style={[styles.ring, { borderColor }, selected && styles.ringSelected]}>
          <ExpoImage
            source={{ uri }}
            style={styles.avatar}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={uri}
            transition={120}
          />
          {!isConfirmed ? <View style={styles.avatarNegotiatingOverlay} pointerEvents="none" /> : null}
        </View>

        <View style={[styles.badge, { backgroundColor: borderColor }]}>
          {pulseEnabled && isConfirmed ? (
            <Animated.View style={[styles.badgePulseRing, pulseStyle]} pointerEvents="none" />
          ) : null}
          <GinitSymbolicIcon name={visual.icon} size={12} color="#fff" />
        </View>
      </View>

      {/* 모임 제목 칩 숨김 */}
    </View>
  );
}

export const PeopleCentricMeetingMarker = memo(PeopleCentricMeetingMarkerInner);

const styles = StyleSheet.create({
  androidHit: {
    width: ANDROID_CANVAS,
    height: ANDROID_CANVAS,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: ANDROID_CANVAS / 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  androidAvatar: {
    width: ANDROID_CANVAS,
    height: ANDROID_CANVAS,
    borderRadius: ANDROID_CANVAS / 2,
  },
  naverPinBox: {
    width: NAVER_PIN_BOX_W,
    height: NAVER_PIN_BOX_H,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 6,
    backgroundColor: 'transparent',
  },
  naverPinRing: {
    width: NAVER_PIN_AVATAR + NAVER_PIN_BORDER * 2,
    height: NAVER_PIN_AVATAR + NAVER_PIN_BORDER * 2,
    borderRadius: (NAVER_PIN_AVATAR + NAVER_PIN_BORDER * 2) / 2,
    borderWidth: NAVER_PIN_BORDER,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  naverPinRingSelected: {
    shadowColor: 'rgba(15, 23, 42, 0.26)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 8,
  },
  naverPinAvatar: {
    width: NAVER_PIN_AVATAR,
    height: NAVER_PIN_AVATAR,
    borderRadius: NAVER_PIN_AVATAR / 2,
  },
  naverAvatarOnlyHit: {
    width: NAVER_AVATAR_ONLY + NAVER_AVATAR_ONLY_BORDER * 2,
    height: NAVER_AVATAR_ONLY + NAVER_AVATAR_ONLY_BORDER * 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  naverAvatarOnlyRing: {
    width: NAVER_AVATAR_ONLY + NAVER_AVATAR_ONLY_BORDER * 2,
    height: NAVER_AVATAR_ONLY + NAVER_AVATAR_ONLY_BORDER * 2,
    borderRadius: (NAVER_AVATAR_ONLY + NAVER_AVATAR_ONLY_BORDER * 2) / 2,
    borderWidth: NAVER_AVATAR_ONLY_BORDER,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  naverAvatarOnlyAvatar: {
    width: NAVER_AVATAR_ONLY,
    height: NAVER_AVATAR_ONLY,
    borderRadius: NAVER_AVATAR_ONLY / 2,
  },
  hit: {
    // Android에서 커스텀 마커 스냅샷이 폭을 잘못 잡아 클리핑되는 케이스가 있어
    // 컨텐츠 캔버스 크기를 명시합니다.
    width: 112,
    height: 72,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingBottom: 2,
  },
  avatarWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    width: AVATAR + BORDER * 2,
    height: AVATAR + BORDER * 2,
    borderRadius: (AVATAR + BORDER * 2) / 2,
    borderWidth: BORDER,
    padding: 0,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  ringSelected: {
    shadowColor: GinitTheme.trustBlue,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 6,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
  },
  avatarNegotiatingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(148, 163, 184, 0.22)',
  },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#fff',
    shadowColor: 'rgba(15, 23, 42, 0.28)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 5,
    elevation: 4,
    overflow: 'visible',
  },
  badgePulseRing: {
    position: 'absolute',
    left: -4,
    top: -4,
    right: -4,
    bottom: -4,
    borderRadius: (BADGE + 8) / 2,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.95)',
  },
  // (모임 제목 칩 스타일 제거됨)
});
