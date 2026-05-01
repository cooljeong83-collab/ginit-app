import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GinitTheme } from '@/constants/ginit-theme';
import { useInAppAlarms } from '@/src/context/InAppAlarmsContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { pushProfileOpenRegisterInfo } from '@/src/lib/profile-register-info';
import { subscribeTabBarFabDocked } from '@/src/lib/tabbar-fab-scroll';
import { getUserProfile, isUserPhoneVerified, meetingDemographicsIncomplete } from '@/src/lib/user-profile';

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
  const { chatTabUnreadTotal, friendsTabPendingRequestBadge } = useInAppAlarms();
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
    const gap = 0; // FAB ↔ 탭 메뉴 사이(기존 12 → 조금 축소)
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
          if (!isUserPhoneVerified(p)) {
            Alert.alert('인증 정보 등록', '모임을 이용하시려면 인증 정보 등록을 완료하셔야 합니다.', [
              { text: '확인', onPress: () => pushProfileOpenRegisterInfo(router) },
            ]);
            return;
          }
          if (meetingDemographicsIncomplete(p, pk)) {
            Alert.alert(
              '프로필을 완성해 주세요',
              'SNS로 가입한 계정은 모임을 만들기 전에 프로필에서 성별과 연령대를 입력해야 해요.',
              [
                { text: '닫기', style: 'cancel' },
                { text: '정보 등록하기', onPress: () => pushProfileOpenRegisterInfo(router) },
              ],
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

  /** 스크롤 시 알약 → 동그라미(정원) 형태로 보간 */
  const fabLayoutStyle = useAnimatedStyle(() => {
    const dock = fabDocked.value;
    const w = interpolate(dock, [0, 1], [112, 56], Extrapolation.CLAMP);
    const h = interpolate(dock, [0, 1], [58, 56], Extrapolation.CLAMP);
    const br = interpolate(dock, [0, 1], [29, 28], Extrapolation.CLAMP);
    return { width: w, height: h, borderRadius: br };
  });

  const fabRadiusStyle = useAnimatedStyle(() => {
    const dock = fabDocked.value;
    const br = interpolate(dock, [0, 1], [29, 28], Extrapolation.CLAMP);
    return { borderRadius: br };
  });

  const fabAnimStyle = useAnimatedStyle(() => {
    const dock = fabDocked.value;
    const f = fabFloat.value; // 0..1..0..
    const floatY = -4 + (f - 0.5) * 6;
    const translateY = (1 - dock) * floatY;
    // 도킹 시에는 크기 변화는 fabLayoutStyle이 담당 — 스케일은 1에 가깝게 유지
    const breathe = 1 + (1 - dock) * ((f - 0.5) * 0.04);
    const scale = breathe;
    return {
      transform: [{ translateY }, { scale }],
      opacity: 1,
    };
  });

  const fabLabelStyle = useAnimatedStyle(() => {
    const dock = fabDocked.value;
    return {
      opacity: 1 - dock,
      maxWidth: interpolate(dock, [0, 1], [160, 0], Extrapolation.CLAMP),
      transform: [{ scaleX: interpolate(dock, [0, 1], [1, 0.92], Extrapolation.CLAMP) }],
    };
  });

  const fabContentPadStyle = useAnimatedStyle(() => {
    const dock = fabDocked.value;
    return {
      paddingHorizontal: interpolate(dock, [0, 1], [14, 0], Extrapolation.CLAMP),
      gap: interpolate(dock, [0, 1], [8, 0], Extrapolation.CLAMP),
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

            const chatBadge =
              route.name === 'chat' && chatTabUnreadTotal > 0
                ? chatTabUnreadTotal > 99
                  ? '99+'
                  : String(chatTabUnreadTotal)
                : null;

            const friendsBadge =
              route.name === 'friends' && friendsTabPendingRequestBadge > 0
                ? friendsTabPendingRequestBadge > 99
                  ? '99+'
                  : String(friendsTabPendingRequestBadge)
                : null;

            const tabBadge = chatBadge ?? friendsBadge;
            const a11yBadgeLabel =
              chatBadge != null
                ? `읽지 않은 채팅 ${chatTabUnreadTotal > 99 ? '99개 이상' : `${chatTabUnreadTotal}개`}`
                : friendsBadge != null
                  ? `처리할 친구 요청 ${friendsTabPendingRequestBadge > 99 ? '99건 이상' : `${friendsTabPendingRequestBadge}건`}`
                  : null;

            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
                accessibilityState={focused ? { selected: true } : {}}
                accessibilityLabel={a11yBadgeLabel ? `${label}, ${a11yBadgeLabel}` : label}
                onPress={() => onTabPress(route, originalIndex)}
                style={styles.tab}>
                <View style={styles.tabIconCluster}>
                  <Ionicons
                    name={iconFor(route.name, focused)}
                    size={24}
                    color={focused ? GinitTheme.colors.primary : 'rgba(100, 116, 139, 0.85)'}
                  />
                  {tabBadge ? (
                    <View style={styles.tabUnreadBadge} accessibilityElementsHidden>
                      <Text style={styles.tabUnreadBadgeText} numberOfLines={1}>
                        {tabBadge}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.tabLabel, focused && styles.tabLabelActive]} numberOfLines={1}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {showFab ? (
        <Animated.View
          pointerEvents="box-none"
          style={[{ position: 'absolute', right: 18, bottom: fabSafeBottom }, fabLayoutStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="모임 만들기"
            onPress={onFabPress}
            style={StyleSheet.absoluteFillObject}>
            <Animated.View style={[styles.fabInner, fabAnimStyle, fabRadiusStyle]}>
              <View style={styles.fabBg} pointerEvents="none" />
              <Animated.View style={[styles.fabContent, fabContentPadStyle]}>
                <View style={styles.fabLogo} pointerEvents="none">
                  <Ionicons name="add" size={24} color="#FFFFFF" />
                </View>
                <Animated.View style={[styles.fabLabelWrap, fabLabelStyle]}>
                  <Text style={styles.fabLabelText} numberOfLines={1}>
                    모임 생성
                  </Text>
                </Animated.View>
              </Animated.View>
            </Animated.View>
          </Pressable>
        </Animated.View>
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
  tabIconCluster: {
    width: 40,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    zIndex: 0,
  },
  tabUnreadBadge: {
    position: 'absolute',
    top: -2,
    right: 2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
    zIndex: 2,
    elevation: 4,
  },
  tabUnreadBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: -0.35,
    lineHeight: 12,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(100, 116, 139, 0.85)',
  },
  tabLabelActive: {
    color: GinitTheme.colors.primary,
  },
  fabInner: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
    backgroundColor: GinitTheme.trustBlue,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.trustBlue,
  },
  fabBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: GinitTheme.trustBlue,
  },
  fabContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabLogo: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabLabelWrap: {
    overflow: 'hidden',
  },
  fabLabelText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
});
