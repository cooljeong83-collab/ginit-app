import { GinitPressable } from '@/components/ui/GinitPressable';

import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Dimensions, type ListRenderItem, Platform, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OnboardingPagerDots } from '@/components/onboarding/OnboardingPagerDots';
import { OnboardingSlidePage } from '@/components/onboarding/OnboardingSlidePage';
import { ONBOARDING_SLIDE_COUNT } from '@/components/onboarding/onboarding-motion';
import { ONBOARDING_SLIDES, type OnboardingSlide } from '@/components/onboarding/onboarding-slides';
import { useOnboardingReducedMotion } from '@/components/onboarding/use-onboarding-reduced-motion';
import { GinitTheme } from '@/constants/ginit-theme';
import { writeAppIntroComplete } from '@/src/lib/onboarding-storage';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const SLIDE_HEIGHT = Math.max(400, SCREEN_H - 220);
const LAST_INDEX = ONBOARDING_SLIDE_COUNT - 1;

function paramToString(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export default function OnboardingScreen() {
  const router = useTransitionRouter();
  const params = useLocalSearchParams<{ next?: string | string[]; phone?: string | string[] }>();
  const nextRaw = paramToString(params.next);
  const next = nextRaw === 'tabs' ? 'tabs' : 'login';
  const phoneParam = paramToString(params.phone);
  const reduceMotion = useOnboardingReducedMotion();

  const listRef = useRef<Animated.FlatList<OnboardingSlide>>(null);
  const scrollX = useSharedValue(0);
  const [page, setPage] = useState(0);
  const lastHapticPage = useRef(-1);

  const finishAndLeave = useCallback(async () => {
    await writeAppIntroComplete();
    if (next === 'tabs') {
      router.replace('/(tabs)');
      return;
    }
    if (phoneParam) {
      router.replace({ pathname: '/login', params: { phone: phoneParam } });
      return;
    }
    router.replace('/login');
  }, [next, phoneParam, router]);

  const onStartPress = useCallback(() => {
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    void finishAndLeave();
  }, [finishAndLeave]);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollX.value = e.contentOffset.x;
    },
  });

  const onMomentumEnd = useCallback(
    (offsetX: number) => {
      const idx = Math.min(Math.max(0, Math.round(offsetX / SCREEN_W)), LAST_INDEX);
      setPage(idx);
      if (idx !== lastHapticPage.current && Platform.OS !== 'web') {
        lastHapticPage.current = idx;
        void Haptics.selectionAsync();
      }
    },
    [],
  );

  const goNext = useCallback(() => {
    if (page >= LAST_INDEX) return;
    const nextIdx = page + 1;
    listRef.current?.scrollToOffset({ offset: nextIdx * SCREEN_W, animated: true });
    setPage(nextIdx);
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync();
    }
  }, [page]);

  const renderItem: ListRenderItem<OnboardingSlide> = useCallback(
    ({ item, index }) => (
      <OnboardingSlidePage
        item={item}
        index={index}
        scrollX={scrollX}
        screenWidth={SCREEN_W}
        slideHeight={SLIDE_HEIGHT}
        activePage={page}
        reduceMotion={reduceMotion}
      />
    ),
    [scrollX, page, reduceMotion],
  );

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <GinitPressable
            onPress={() => void finishAndLeave()}
            style={({ pressed }) => [styles.skipBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="건너뛰기">
            <Text style={styles.skipLabel}>건너뛰기</Text>
          </GinitPressable>
        </View>

        <View style={styles.mainCol}>
          <Animated.FlatList
            ref={listRef}
            data={[...ONBOARDING_SLIDES]}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            bounces={false}
            decelerationRate="fast"
            style={styles.pager}
            onScroll={onScroll}
            scrollEventThrottle={16}
            onMomentumScrollEnd={(e) => onMomentumEnd(e.nativeEvent.contentOffset.x)}
            getItemLayout={(_, index) => ({ length: SCREEN_W, offset: SCREEN_W * index, index })}
            windowSize={3}
            initialNumToRender={2}
            maxToRenderPerBatch={2}
            removeClippedSubviews
          />

          <View style={styles.footer}>
            <OnboardingPagerDots activePage={page} />

            {page < LAST_INDEX ? (
              <GinitPressable
                onPress={goNext}
                style={({ pressed }) => [styles.btnSecondary, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="다음">
                <Text style={styles.btnSecondaryLabel}>다음</Text>
              </GinitPressable>
            ) : (
              <GinitPressable
                onPress={onStartPress}
                style={({ pressed }) => [styles.btnPrimary, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="시작하기">
                <Text style={styles.btnPrimaryLabel}>시작하기</Text>
              </GinitPressable>
            )}
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  safe: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: GinitTheme.spacing.md,
    paddingTop: 4,
    paddingBottom: 8,
  },
  skipBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  skipLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: GinitTheme.colors.textSub,
  },
  mainCol: {
    flex: 1,
  },
  pager: {
    flex: 1,
  },
  footer: {
    paddingHorizontal: GinitTheme.spacing.xl,
    paddingBottom: 22,
    paddingTop: 10,
    gap: 16,
    alignItems: 'center',
  },
  btnPrimary: {
    alignSelf: 'stretch',
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: GinitTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  btnPrimaryLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  btnSecondary: {
    alignSelf: 'stretch',
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(31, 42, 68, 0.22)',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSecondaryLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: GinitTheme.colors.primary,
  },
  pressed: {
    opacity: 0.88,
  },
});
