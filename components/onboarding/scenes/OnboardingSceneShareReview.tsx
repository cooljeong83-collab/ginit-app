import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInRight, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import {
  FEED_REVIEW_COMMENT_FADE_MS,
  FEED_REVIEW_COMMENT_ROTATION_HOLD_MIN_MS,
} from '@/src/lib/feed-meeting-review-comment-marquee.logic';
import { onboardingSceneStyles as ss } from '@/components/onboarding/scenes/onboarding-scene-styles';
import { GinitTheme } from '@/constants/ginit-theme';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';

const COMMENTS = ['분위기 최고였어요', '다음에도 여기로!', '커피 맛집 인정'] as const;

type Props = { isActive: boolean };

export function OnboardingSceneShareReview({ isActive }: Props) {
  const [commentIdx, setCommentIdx] = useState(0);
  const linkPulse = useSharedValue(1);

  useEffect(() => {
    if (!isActive) {
      setCommentIdx(0);
      linkPulse.value = 1;
      return;
    }
    linkPulse.value = withRepeat(
      withSequence(withTiming(1.08, { duration: 700 }), withTiming(1, { duration: 700 })),
      -1,
      false,
    );
    const id = setInterval(() => {
      setCommentIdx((i) => (i + 1) % COMMENTS.length);
    }, FEED_REVIEW_COMMENT_ROTATION_HOLD_MIN_MS + FEED_REVIEW_COMMENT_FADE_MS);
    return () => clearInterval(id);
  }, [isActive, linkPulse]);

  const linkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: linkPulse.value }],
  }));

  if (!isActive) return <View style={ss.hero} />;

  return (
    <View style={ss.hero} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View entering={FadeIn.duration(320)} style={[ss.glassCard, styles.reviewCard]}>
        <Text style={styles.place}>☕ 강남 카페 모임</Text>
        <Text style={styles.rating}>💜 4.8</Text>
        <Text style={styles.comment} numberOfLines={1}>
          {COMMENTS[commentIdx]}
        </Text>
      </Animated.View>
      <Animated.View style={[styles.linkRow, linkStyle]}>
        <GinitSymbolicIcon name="share-outline" size={20} color={GinitTheme.colors.primary} />
        <Text style={ss.accent}>ginit-share.app/s/…</Text>
      </Animated.View>
      <View style={styles.targets}>
        <Animated.View entering={FadeInRight.delay(200).duration(280)} style={styles.target}>
          <GinitSymbolicIcon name="person-outline" size={22} color={GinitTheme.colors.primary} />
          <Text style={ss.chipText}>앱</Text>
        </Animated.View>
        <Animated.View entering={FadeInRight.delay(360).duration(280)} style={styles.target}>
          <GinitSymbolicIcon name="globe-outline" size={22} color={GinitTheme.colors.accent2} />
          <Text style={ss.chipText}>웹</Text>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  reviewCard: { alignSelf: 'stretch', marginHorizontal: 12, gap: 4 },
  place: { fontSize: 14, fontWeight: '800', color: GinitTheme.colors.text },
  rating: { fontSize: 13, fontWeight: '700', color: GinitTheme.colors.primary },
  comment: { fontSize: 12, fontWeight: '600', color: GinitTheme.colors.textSub },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: GinitTheme.colors.primarySoft,
  },
  targets: { flexDirection: 'row', gap: 24, marginTop: 16 },
  target: { alignItems: 'center', gap: 4 },
});
