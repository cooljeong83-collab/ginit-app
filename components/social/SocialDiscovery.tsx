import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useCallback, useMemo, useState } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

import { NeonBadge } from '@/components/social/NeonBadge';
import { NeonConfirmButton } from '@/components/social/NeonConfirmButton';
import { GinitTheme } from '@/constants/ginit-theme';
import { HomeGlassStyles, homeBlurIntensity, shouldUseStaticGlassInsteadOfBlur } from '@/constants/home-glass-styles';

const { width: W } = Dimensions.get('window');
const SWIPE_OFF = W * 0.35;

export type DiscoveryCardProfile = {
  userId: string;
  displayName: string;
  /** 예: "29" 또는 "20대" */
  ageLabel: string;
  gLevel: number;
  gTrust: number;
  gDna: string;
  photoUrl: string | null;
};

type Props = {
  /** 추천 카드 스택(앞에서부터 표시) */
  profiles: DiscoveryCardProfile[];
  /** 오른쪽 스와이프 / 수락 시 */
  onAccept: (userId: string) => void;
  /** 왼쪽 스와이프 시 */
  onPass: (userId: string) => void;
};

/**
 * 지닛 디스커버리 — 홈 모임 카드형 글래스 하단 + 전면 사진 배경, 스와이프 + 네온 수락 CTA.
 */
export function SocialDiscovery({ profiles, onAccept, onPass }: Props) {
  const [index, setIndex] = useState(0);
  const current = profiles[index];
  const tx = useSharedValue(0);
  const rot = useSharedValue(0);

  const swipeOut = useCallback(
    (dir: 1 | -1) => {
      tx.value = 0;
      rot.value = 0;
      setIndex((i) => {
        const p = profiles[i];
        if (!p) return i;
        if (dir === 1) onAccept(p.userId);
        else onPass(p.userId);
        return i + 1;
      });
    },
    [profiles, onAccept, onPass, tx, rot],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onUpdate((e) => {
          tx.value = e.translationX;
          rot.value = e.translationX / 40;
        })
        .onEnd((e) => {
          if (e.translationX > SWIPE_OFF) {
            runOnJS(swipeOut)(1);
          } else if (e.translationX < -SWIPE_OFF) {
            runOnJS(swipeOut)(-1);
          } else {
            tx.value = withSpring(0);
            rot.value = withSpring(0);
          }
        }),
    [swipeOut, tx, rot],
  );

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { rotate: `${rot.value}deg` }],
  }));

  if (!current) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyTitle}>새로운 지닛을 준비 중이에요</Text>
        <Text style={styles.emptySub}>잠시 후 다시 열어 주세요.</Text>
      </View>
    );
  }

  const uri =
    current.photoUrl?.trim() ||
    'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=800&q=80';

  return (
    <View style={styles.root}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.card, cardStyle]}>
          <Image source={{ uri }} style={styles.bgPhoto} contentFit="cover" />
          <View style={styles.bgScrim} />
          <View style={styles.badgeDock}>
            <NeonBadge
              label={`gTrust ${current.gTrust}\n${current.gDna}`}
              pulse={current.gTrust >= 90}
            />
          </View>
          <View style={styles.bottomGlass}>
            {shouldUseStaticGlassInsteadOfBlur() ? (
              <View style={[styles.blurFill, styles.staticGlass]} />
            ) : (
              <BlurView intensity={homeBlurIntensity} tint="light" style={styles.blurFill} experimentalBlurMethod="dimezisBlurView" />
            )}
            <View style={HomeGlassStyles.miniCardVeil} pointerEvents="none" />
            <View style={styles.bottomInner}>
              <View style={styles.zoneA}>
                <Text style={styles.name} numberOfLines={1}>
                  {current.displayName}
                </Text>
                <Text style={styles.ageG}>
                  {current.ageLabel} · Lv.{current.gLevel}
                </Text>
              </View>
              <Text style={styles.hint}>오른쪽으로 밀어 수락 · 왼쪽으로 넘기기</Text>
              <NeonConfirmButton label="지닛 수락" onPress={() => swipeOut(1)} />
            </View>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  card: {
    flex: 1,
    maxHeight: 520,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    ...GinitTheme.shadow.card,
  },
  bgPhoto: {
    ...StyleSheet.absoluteFillObject,
  },
  bgScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.25)',
  },
  badgeDock: {
    position: 'absolute',
    right: 12,
    top: 14,
    maxWidth: '46%',
  },
  bottomGlass: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 168,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  blurFill: {
    ...StyleSheet.absoluteFillObject,
  },
  staticGlass: {
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
  },
  bottomInner: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 18,
    gap: 6,
  },
  zoneA: {
    gap: 4,
  },
  name: {
    fontSize: 22,
    fontWeight: '600',
    color: '#0f172a',
    letterSpacing: -0.4,
  },
  ageG: {
    fontSize: 14,
    fontWeight: '600',
    color: GinitTheme.colors.primary,
  },
  hint: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    marginTop: 4,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#0f172a',
  },
  emptySub: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
  },
});

/** 홈 피드와 동일한 모임 카드 — 디스커버리 확장 시 import 경로 통일용 */
export { MeetingCard } from '@/components/social/MeetingCard';
