import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { pushProfileOpenRegisterInfo } from '@/src/lib/profile-register-info';
import { getUserProfile, isGoogleSnsDemographicsIncomplete } from '@/src/lib/user-profile';
import { subscribeTabBarFabDocked } from '@/src/lib/tabbar-fab-scroll';

const ORDER = ['index', 'map', 'friends', 'chat', 'profile'] as const;

function iconFor(routeName: string, focused: boolean): keyof typeof Ionicons.glyphMap {
  switch (routeName) {
    case 'index':
      return focused ? 'people' : 'people-outline';
    case 'map':
      return focused ? 'map' : 'map-outline';
    case 'friends':
      return focused ? 'people-circle' : 'people-circle-outline';
    case 'chat':
      return focused ? 'chatbubbles' : 'chatbubbles-outline';
    case 'profile':
      return focused ? 'person' : 'person-outline';
    default:
      return 'ellipse-outline';
  }
}

/**
 * 모크업 스타일: 하단 탭 + 중앙 오렌지 FAB.
 */
export function GinitTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const router = useRouter();
  const { userId } = useUserSession();
  const insets = useSafeAreaInsets();
  const routes = ORDER.map((name) => state.routes.find((r) => r.name === name)).filter(Boolean) as (typeof state.routes)[number][];
  const fabDocked = useSharedValue(0);
  const fabFloat = useSharedValue(0);
  const [, setFabDockedUi] = useState(false);
  const activeRouteName = state.routes[state.index]?.name ?? '';
  const showFab = activeRouteName === 'index';
  const fabSafeBottom = useMemo(() => {
    // 탭바(콘텐츠 영역) + wrap의 paddingBottom 위로 확실히 띄웁니다.
    const tabBarH = 52 + 8; // row minHeight + paddingTop
    const wrapPad = Math.max(insets.bottom, 10);
    const gap = 12;
    return wrapPad + tabBarH + gap;
  }, [insets.bottom]);

  const onTabPress = (route: (typeof state.routes)[number], routeIndex: number) => {
    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });
    if (!event.defaultPrevented) {
      navigation.navigate(route.name as never);
    }
    if (state.index !== routeIndex && Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const onFabPress = () => {
    void (async () => {
      if (Platform.OS !== 'web') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      const pk = userId?.trim();
      if (pk) {
        try {
          const p = await getUserProfile(pk);
          if (isGoogleSnsDemographicsIncomplete(p)) {
            Alert.alert(
              '프로필을 완성해 주세요',
              'SNS로 가입한 계정은 모임을 만들기 전에 프로필에서 성별과 연령대를 입력해야 해요.',
              [{ text: '정보 등록하기', onPress: () => pushProfileOpenRegisterInfo(router) }],
            );
            return;
          }
        } catch {
          /* 네트워크 실패 시에는 생성 화면으로 보냄(등록 시 서버 검증) */
        }
      }
      const d = new Date();
      const scheduleDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      router.push({
        pathname: '/create/details',
        params: { scheduleDate, scheduleTime: '15:00' },
      });
    })();
  };

  // 초기 진입: 공이 통통 튀는 느낌(스케일 + 살짝 위아래)
  // 스크롤 발생 시: 가운데로 작아져서 "쏙" 들어감
  useEffect(() => {
    const unsub = subscribeTabBarFabDocked((docked) => {
      setFabDockedUi(docked);
      fabDocked.value = withTiming(docked ? 1 : 0, { duration: docked ? 180 : 240 });
      if (!docked) {
        // 둥둥 떠있는 느낌: 아주 작은 상하 이동 + 호흡 (메뉴 라인을 넘지 않도록 제한)
        fabFloat.value = 0;
        fabFloat.value = withDelay(
          120,
          withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.sin) }), -1, true),
        );
      } else {
        // dock되면 떠있는 애니메이션은 정지
        fabFloat.value = withTiming(0, { duration: 120 });
      }
    });
    return () => unsub();
  }, [fabDocked, fabFloat]);

  const fabAnimStyle = useAnimatedStyle(() => {
    const dock = fabDocked.value;
    const f = fabFloat.value; // 0..1..0..
    // undocked: -3..-1 정도로만 떠있게 (상단으로 과하게 올라가지 않게 제한)
    const floatY = -4 + (f - 0.5) * 6; // [-7, -1]
    const translateY = (1 - dock) * floatY;
    const opacity = 1;
    const baseScale = (1 - dock) * 1 + dock * 0.84;
    const breathe = 1 + (1 - dock) * ((f - 0.5) * 0.04); // +/- 2%
    const scale = baseScale * breathe;
    return {
      transform: [{ translateY }, { scale }],
      opacity,
    };
  });

  const fabLabelStyle = useAnimatedStyle(() => {
    const dock = fabDocked.value;
    return {
      opacity: 1 - dock,
      transform: [{ scaleX: 1 - dock * 0.12 }],
    };
  });

  const fabShadowStyle = useAnimatedStyle(() => {
    const dock = fabDocked.value;
    const f = fabFloat.value;
    // 떠오를수록(위로 갈수록) 그림자는 조금 더 진하고 작아짐
    const lift = 1 - f; // 1(bottom) -> 0(top)
    const opacity = (1 - dock) * (0.22 + 0.10 * lift);
    const s = 1 - 0.12 * lift;
    return {
      opacity,
      transform: [{ scaleX: s }, { scaleY: s }],
    };
  });

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]} pointerEvents="box-none">
      <View style={styles.row}>
        <View style={styles.sideGroup}>
          {routes.map((route) => {
            const originalIndex = state.routes.findIndex((r) => r.key === route.key);
            const focused = state.index === originalIndex;
            const { options } = descriptors[route.key];
            const rawLabel = options.tabBarLabel;
            const label =
              typeof rawLabel === 'string'
                ? rawLabel
                : typeof options.title === 'string'
                  ? options.title
                  : route.name === 'index'
                    ? '모임'
                    : route.name === 'map'
                      ? '지도'
                      : route.name === 'friends'
                        ? '친구'
                        : route.name === 'chat'
                          ? '채팅'
                          : '프로필';

            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
                accessibilityState={focused ? { selected: true } : {}}
                onPress={() => onTabPress(route, originalIndex)}
                style={styles.tab}>
                <Ionicons
                  name={iconFor(route.name, focused)}
                  size={24}
                  color={focused ? GinitTheme.colors.primary : 'rgba(100, 116, 139, 0.85)'}
                />
                <Text style={[styles.tabLabel, focused && styles.tabLabelActive]} numberOfLines={1}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {showFab ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="모임 만들기"
          onPress={onFabPress}
          style={[
            styles.fab,
            {
              bottom: fabSafeBottom,
            },
          ]}>
          <Animated.View style={[styles.fabShadow, fabShadowStyle]} pointerEvents="none" />
          <Animated.View style={[styles.fabInner, fabAnimStyle]}>
            <LinearGradient
              colors={GinitTheme.colors.ctaGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.fabBg}
              pointerEvents="none"
            />
            <View style={styles.fabContent}>
              <Image
                source={require('@/assets/images/logo-symbol.png')}
                style={styles.fabLogo}
                contentFit="contain"
                accessibilityIgnoresInvertColors
              />
              <Animated.View style={[styles.fabLabelWrap, fabLabelStyle]}>
                <Text style={styles.fabLabelText} numberOfLines={1}>
                  모임 생성
                </Text>
              </Animated.View>
            </View>
          </Animated.View>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(15, 23, 42, 0.10)',
    shadowColor: 'rgba(15, 23, 42, 0.16)',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 1,
    shadowRadius: 18,
    elevation: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingTop: 8,
    minHeight: 52,
  },
  sideGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  tab: {
    flexGrow: 0,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(100, 116, 139, 0.85)',
  },
  tabLabelActive: {
    color: GinitTheme.colors.primary,
  },
  fab: {
    position: 'absolute',
    right: 18,
    width: 112,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'rgba(15, 23, 42, 0.14)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 14,
    elevation: 10,
  },
  fabInner: {
    width: 112,
    height: 58,
    borderRadius: 29,
    overflow: 'hidden',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.72)',
  },
  fabShadow: {
    position: 'absolute',
    bottom: -20,
    width: 56,
    height: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.22)',
  },
  fabBg: {
    ...StyleSheet.absoluteFillObject,
  },
  fabContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  fabLogo: {
    width: 28,
    height: 28,
  },
  fabLabelWrap: {
    overflow: 'hidden',
  },
  fabLabelText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
});
