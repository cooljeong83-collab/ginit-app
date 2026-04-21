import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  type ListRenderItem,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GinitTheme } from '@/constants/ginit-theme';
import { writeAppIntroComplete } from '@/src/lib/onboarding-storage';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const SLIDE_HEIGHT = Math.max(400, SCREEN_H - 220);

type IllustrationKind = 'gathering' | 'calendar' | 'memories';

type Slide = {
  id: string;
  title: string;
  body: string;
  illustration: IllustrationKind;
  /** 1번 슬라이드만 로고 병행 */
  showLogo?: boolean;
};

const SLIDES: Slide[] = [
  {
    id: '1',
    title: '모임의 시작, 지닛(Ginit)',
    body: '친구·동료와의 모임을 한곳에서 준비하고,\n만남이 더 편안해지도록 돕습니다.',
    illustration: 'gathering',
    showLogo: true,
  },
  {
    id: '2',
    title: '일정 조율은 지닛에게 맡기세요',
    body: '가능한 시간을 모으고 일정을 정리해,\n모두가 참여하기 쉬운 흐름을 만들어 드려요.',
    illustration: 'calendar',
  },
  {
    id: '3',
    title: '함께 만들어 더 즐거운 추억',
    body: '모임의 순간을 기록하고 공유하며,\n함께하는 시간을 더 특별하게 남겨 보세요.',
    illustration: 'memories',
  },
];

function paramToString(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function IllustrationPlaceholder({ kind }: { kind: IllustrationKind }) {
  const icon =
    kind === 'gathering' ? (
      <Ionicons name="people-outline" size={56} color="#64748b" />
    ) : kind === 'calendar' ? (
      <Ionicons name="calendar-outline" size={56} color="#64748b" />
    ) : (
      <Ionicons name="images-outline" size={56} color="#64748b" />
    );
  return (
    <View style={illusStyles.frame} accessibilityLabel="일러스트 영역(추후 이미지 삽입)">
      {icon}
      <Text style={illusStyles.caption}>이미지</Text>
    </View>
  );
}

const illusStyles = StyleSheet.create({
  frame: {
    width: SCREEN_W * 0.72,
    maxWidth: 300,
    aspectRatio: 1.15,
    borderRadius: 20,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(15, 23, 42, 0.14)',
    backgroundColor: 'rgba(248, 250, 252, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  caption: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.3,
  },
});

function SlidePage({
  item,
  index,
  scrollX,
}: {
  item: Slide;
  index: number;
  scrollX: Animated.Value;
}) {
  const opacity = scrollX.interpolate({
    inputRange: [(index - 1) * SCREEN_W, index * SCREEN_W, (index + 1) * SCREEN_W],
    outputRange: [0.38, 1, 0.38],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View style={[styles.slide, { width: SCREEN_W, minHeight: SLIDE_HEIGHT, opacity }]}>
      {item.showLogo ? (
        <View style={styles.logoRow}>
          <View style={styles.logoCard}>
            <Image source={require('@/assets/images/logo-symbol.png')} style={styles.logoImg} contentFit="contain" />
          </View>
        </View>
      ) : null}
      <IllustrationPlaceholder kind={item.illustration} />
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.body}>{item.body}</Text>
    </Animated.View>
  );
}

export default function OnboardingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string | string[]; phone?: string | string[] }>();
  const nextRaw = paramToString(params.next);
  const next = nextRaw === 'tabs' ? 'tabs' : 'login';
  const phoneParam = paramToString(params.phone);

  const listRef = useRef<Animated.FlatList<Slide>>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const [page, setPage] = useState(0);
  const lastIndex = SLIDES.length - 1;

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

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const idx = Math.round(x / SCREEN_W);
      setPage(Math.min(Math.max(0, idx), lastIndex));
    },
    [lastIndex],
  );

  const goNext = useCallback(() => {
    if (page >= lastIndex) return;
    const nextIdx = page + 1;
    listRef.current?.scrollToOffset({ offset: nextIdx * SCREEN_W, animated: true });
    setPage(nextIdx);
  }, [page, lastIndex]);

  const renderItem: ListRenderItem<Slide> = useCallback(
    ({ item, index }) => {
      return <SlidePage item={item} index={index} scrollX={scrollX} />;
    },
    [scrollX],
  );

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable
            onPress={() => void finishAndLeave()}
            style={({ pressed }) => [styles.skipBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="건너뛰기">
            <Text style={styles.skipLabel}>건너뛰기</Text>
          </Pressable>
        </View>

        <View style={styles.mainCol}>
          <Animated.FlatList
            ref={listRef}
            data={SLIDES}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            bounces={false}
            decelerationRate="fast"
            style={styles.pager}
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
              useNativeDriver: false,
            })}
            scrollEventThrottle={16}
            onMomentumScrollEnd={onMomentumEnd}
            getItemLayout={(_, index) => ({ length: SCREEN_W, offset: SCREEN_W * index, index })}
          />

          <View style={styles.footer}>
            <View style={styles.dots} accessibilityRole="tablist" accessibilityLabel="온보딩 페이지">
              {SLIDES.map((s, i) => (
                <View
                  key={s.id}
                  style={[styles.dot, i === page ? styles.dotActive : styles.dotIdle]}
                  accessibilityLabel={`${i + 1}번째 슬라이드${i === page ? ', 현재' : ''}`}
                />
              ))}
            </View>

            {page < lastIndex ? (
              <Pressable
                onPress={goNext}
                style={({ pressed }) => [styles.btnSecondary, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="다음">
                <Text style={styles.btnSecondaryLabel}>다음</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => void finishAndLeave()}
                style={({ pressed }) => [styles.btnPrimary, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="시작하기">
                <Text style={styles.btnPrimaryLabel}>시작하기</Text>
              </Pressable>
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
  slide: {
    paddingHorizontal: GinitTheme.spacing.xl,
    paddingTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  logoRow: {
    marginBottom: 4,
  },
  logoCard: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    shadowColor: GinitTheme.shadow.card.shadowColor,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 5,
  },
  logoImg: { width: 48, height: 48 },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: GinitTheme.colors.text,
    textAlign: 'center',
    letterSpacing: -0.55,
    paddingHorizontal: 8,
  },
  body: {
    fontSize: 15,
    fontWeight: '600',
    color: GinitTheme.colors.textSub,
    textAlign: 'center',
    lineHeight: 23,
    maxWidth: 320,
  },
  footer: {
    paddingHorizontal: GinitTheme.spacing.xl,
    paddingBottom: 22,
    paddingTop: 10,
    gap: 16,
    alignItems: 'center',
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  dotIdle: {
    width: 8,
    backgroundColor: 'rgba(148, 163, 184, 0.45)',
  },
  dotActive: {
    width: 22,
    backgroundColor: GinitTheme.colors.primary,
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
    fontWeight: '900',
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
    fontWeight: '900',
    color: GinitTheme.colors.primary,
  },
  pressed: {
    opacity: 0.88,
  },
});
