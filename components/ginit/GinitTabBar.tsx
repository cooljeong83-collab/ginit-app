
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  MEETING_CREATE_FAB_FLOOR_SHADOW_SLOT,
  MEETING_CREATE_FAB_GRADIENT_COLORS,
  MEETING_CREATE_FAB_IDLE_BOB_DELAY_MS,
  MEETING_CREATE_FAB_IDLE_BOB_DURATION_MS,
  MEETING_CREATE_FAB_IDLE_BREATHE_MUL,
  MEETING_CREATE_FAB_IDLE_FLOAT_Y_BASE,
  MEETING_CREATE_FAB_IDLE_FLOAT_Y_PHASE_MUL,
  MEETING_CREATE_FAB_LOGO,
  MEETING_CREATE_FAB_RISE_FROM,
  MEETING_CREATE_FAB_RISE_SPRING,
  MEETING_CREATE_FAB_SHADOW_BLOB,
  MEETING_CREATE_FAB_SHADOW_FADE_IN_FROM_TY,
  MEETING_CREATE_FAB_SHADOW_PULSE_LIFT_MAX,
  MEETING_CREATE_FAB_SHADOW_PULSE_LIFT_MIN,
  MEETING_CREATE_FAB_SHADOW_PULSE_MUL_MAX,
  MEETING_CREATE_FAB_SHADOW_PULSE_MUL_MIN,
} from '@/components/create/meetingCreateFabShared';
import { GinitSymbolicIcon, type SymbolicIconName } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { useInAppAlarms } from '@/src/context/InAppAlarmsContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { pushProfileOpenRegisterInfo } from '@/src/lib/profile-register-info';
import { subscribeTabBarFabDocked } from '@/src/lib/tabbar-fab-scroll';
import { getUserProfile, isMeetingServiceComplianceComplete } from '@/src/lib/user-profile';

const ORDER = ['index', 'map', 'friends', 'chat', 'profile'] as const;

/** 모임 탭 생성 FAB(버튼+바닥 그림자)를 탭바 기준으로 추가로 위로 올리는 거리(px) */
const MEETING_TAB_CREATE_FAB_LIFT_PX = 8;
/** 상승 스프링이 끝나기 전에 알약 펼침을 시작해 동그라미 정착~확장 사이 공백을 줄임 */
const MEETING_TAB_CREATE_FAB_INTRO_START_DELAY_MS = 1300;

/** 상승 완료 후 원 → 알약 펼침(스크롤 도킹 중에는 intro=1이어도 원 유지). overshootClamping으로 1 초과 진동 시 라벨 opacity·레이아웃 미세 깜빡임 방지 */
const FAB_INTRO_EXPAND_SPRING = { damping: 17, stiffness: 140, overshootClamping: true } as const;

/** 탭 후 알약 → 원 접힘 → 오른쪽으로 퇴장 */
const FAB_EXIT_COLLAPSE_MS = 200;
const FAB_EXIT_DROP_MS = 240;
/** 퇴장 시 오른쪽으로 밀어내는 거리(px) */
const FAB_EXIT_SLIDE_TRANSLATE_X = 200;

function iconFor(routeName: string, focused: boolean): SymbolicIconName {
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
 * 하단 탭 + 모임 탭 전용 모임 생성 FAB(딥퍼플 그라데이션·로고·상승·바닥 그림자 — 생성 화면 에이전트 FAB와 동일 패턴).
 */
export function GinitTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { userId } = useUserSession();
  const { chatTabUnreadTotal, friendsTabPendingRequestBadge } = useInAppAlarms();
  const insets = useSafeAreaInsets();
  const routes = ORDER.map((name) => state.routes.find((r) => r.name === name)).filter(Boolean) as (typeof state.routes)[number][];
  const fabDocked = useSharedValue(0);
  const fabFloat = useSharedValue(0);
  const fabRiseTy = useSharedValue(0);
  const fabRiseScale = useSharedValue(1);
  const fabIntroExpand = useSharedValue(0);
  const fabExitCollapse = useSharedValue(0);
  const fabExitDrop = useSharedValue(0);
  const fabFloorP = useSharedValue(0);
  const fabExitInFlightRef = useRef(false);
  const wasOnCreateFlowRef = useRef(false);
  const [, setFabDockedUi] = useState(false);
  const activeRouteName = state.routes[state.index]?.name ?? '';
  const meetingTabSelected = activeRouteName === 'index';
  const onCreateFlow = useMemo(() => pathname.includes('/create'), [pathname]);
  /** 모임 탭 + 모임 생성 라우트가 아닐 때만 FAB 마운트(생성 화면에서 둥둥·레이아웃 애니 정지로 부하 감소) */
  const showMeetingFab = meetingTabSelected && !onCreateFlow;
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

  const pushCreateDetails = useCallback(
    (scheduleDate: string) => {
      router.push({
        pathname: '/create/details',
        params: { scheduleDate, scheduleTime: '15:00' },
      });
      fabExitInFlightRef.current = false;
    },
    [router],
  );

  const clearFabExitInFlight = useCallback(() => {
    fabExitInFlightRef.current = false;
  }, []);

  /** 모임 탭이 선택된 채로 `/create`에 들어갔다 나오면 entrance effect가 다시 안 돌아가 exit가 1에 고정될 수 있음 → 복귀 시 리셋 */
  useEffect(() => {
    if (!meetingTabSelected) {
      wasOnCreateFlowRef.current = onCreateFlow;
      return;
    }
    if (wasOnCreateFlowRef.current && !onCreateFlow) {
      fabExitCollapse.value = 0;
      fabExitDrop.value = 0;
      fabExitInFlightRef.current = false;
    }
    wasOnCreateFlowRef.current = onCreateFlow;
  }, [meetingTabSelected, onCreateFlow, fabExitCollapse, fabExitDrop]);

  const onFabPress = () => {
    void (async () => {
      if (fabExitInFlightRef.current) {
        return;
      }
      if (Platform.OS !== 'web') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      const pk = userId?.trim();
      if (pk) {
        try {
          const p = await getUserProfile(pk);
          if (!isMeetingServiceComplianceComplete(p, pk)) {
            Alert.alert('인증 정보 등록', '모임을 이용하시려면 약관 동의와 필요한 프로필 정보를 입력해 주세요.', [
              { text: '확인', onPress: () => pushProfileOpenRegisterInfo(router) },
            ]);
            return;
          }
        } catch {
          /* 네트워크 실패 시에는 생성 화면으로 보냄(등록 시 서버 검증) */
        }
      }
      const d = new Date();
      const scheduleDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      fabExitInFlightRef.current = true;
      fabExitDrop.value = 0;
      fabExitCollapse.value = 0;
      fabExitCollapse.value = withTiming(1, { duration: FAB_EXIT_COLLAPSE_MS, easing: Easing.out(Easing.quad) }, (collapseDone) => {
        if (!collapseDone) {
          runOnJS(clearFabExitInFlight)();
          return;
        }
        fabExitDrop.value = withTiming(1, { duration: FAB_EXIT_DROP_MS, easing: Easing.in(Easing.cubic) }, (dropDone) => {
          if (dropDone) {
            runOnJS(pushCreateDetails)(scheduleDate);
          } else {
            runOnJS(clearFabExitInFlight)();
          }
        });
      });
    })();
  };

  /** 모임 FAB가 보일 때만 둥둥 루프(생성 플로우·다른 탭에서는 cancel로 정지). */
  useEffect(() => {
    if (!showMeetingFab) {
      cancelAnimation(fabFloat);
      return;
    }
    fabFloat.value = 0;
    fabFloat.value = withDelay(
      MEETING_CREATE_FAB_IDLE_BOB_DELAY_MS,
      withRepeat(
        withTiming(1, {
          duration: MEETING_CREATE_FAB_IDLE_BOB_DURATION_MS,
          easing: Easing.inOut(Easing.sin),
        }),
        -1,
        true,
      ),
    );
  }, [showMeetingFab, fabFloat]);

  // 스크롤 발생 시: 알약 → 동그라미(정원) 레이아웃만 전환
  useEffect(() => {
    const unsub = subscribeTabBarFabDocked((docked) => {
      setFabDockedUi(docked);
      fabDocked.value = withTiming(docked ? 1 : 0, { duration: docked ? 180 : 240 });
    });
    return () => unsub();
  }, [fabDocked]);

  useEffect(() => {
    if (!showMeetingFab) {
      cancelAnimation(fabFloat);
      cancelAnimation(fabRiseTy);
      cancelAnimation(fabRiseScale);
      cancelAnimation(fabIntroExpand);
      cancelAnimation(fabExitCollapse);
      cancelAnimation(fabExitDrop);
      fabRiseTy.value = 0;
      fabRiseScale.value = 1;
      fabIntroExpand.value = 0;
      fabExitCollapse.value = 0;
      fabExitDrop.value = 0;
      fabFloorP.value = 0;
      return;
    }
    fabExitCollapse.value = 0;
    fabExitDrop.value = 0;
    fabIntroExpand.value = 0;
    fabRiseTy.value = MEETING_CREATE_FAB_RISE_FROM;
    fabRiseScale.value = 0.88;
    fabFloorP.value = 1;
    fabRiseTy.value = withSpring(0, MEETING_CREATE_FAB_RISE_SPRING);
    fabRiseScale.value = withSpring(1, MEETING_CREATE_FAB_RISE_SPRING);
    fabIntroExpand.value = withDelay(
      MEETING_TAB_CREATE_FAB_INTRO_START_DELAY_MS,
      withSpring(1, FAB_INTRO_EXPAND_SPRING),
    );
  }, [showMeetingFab, fabExitCollapse, fabExitDrop, fabFloorP, fabFloat, fabIntroExpand, fabRiseScale, fabRiseTy]);

  /** intro·dock·exit 한 번만 곱해 여러 스타일에서 재사용 */
  const fabPillProgress = useDerivedValue(
    () => fabIntroExpand.value * (1 - fabDocked.value) * (1 - fabExitCollapse.value),
  );

  /** 셸 크기 + 퇴장 슬라이드(워크릿 1개로 통합) */
  const fabShellOuterStyle = useAnimatedStyle(() => {
    const pp = fabPillProgress.value;
    const w = interpolate(pp, [0, 1], [56, 112], Extrapolation.CLAMP);
    const h = interpolate(pp, [0, 1], [56, 58], Extrapolation.CLAMP);
    const drop = fabExitDrop.value;
    return {
      width: w,
      height: h + MEETING_CREATE_FAB_FLOOR_SHADOW_SLOT,
      opacity: interpolate(drop, [0, 0.82, 1], [1, 0.55, 0], Extrapolation.CLAMP),
      transform: [
        {
          translateX: interpolate(drop, [0, 1], [0, FAB_EXIT_SLIDE_TRANSLATE_X], Extrapolation.CLAMP),
        },
      ],
    };
  });

  /** 버튼 면: 레이아웃 + 둥둥(워크릿 1개로 통합) */
  const fabMeetingFaceStyle = useAnimatedStyle(() => {
    const pp = fabPillProgress.value;
    const w = interpolate(pp, [0, 1], [56, 112], Extrapolation.CLAMP);
    const h = interpolate(pp, [0, 1], [56, 58], Extrapolation.CLAMP);
    const br = interpolate(pp, [0, 1], [28, 29], Extrapolation.CLAMP);
    const f = fabFloat.value;
    const floatY = MEETING_CREATE_FAB_IDLE_FLOAT_Y_BASE + (f - 0.5) * MEETING_CREATE_FAB_IDLE_FLOAT_Y_PHASE_MUL;
    const translateY = fabRiseTy.value + floatY;
    const breathe = 1 + (f - 0.5) * MEETING_CREATE_FAB_IDLE_BREATHE_MUL;
    const scale = fabRiseScale.value * breathe;
    return {
      width: w,
      height: h,
      borderRadius: br,
      transform: [{ translateY }, { scale }],
      opacity: 1,
    };
  });

  const fabFloorShadowStyle = useAnimatedStyle(() => {
    const p = fabFloorP.value;
    const pp = fabPillProgress.value;
    const w = interpolate(pp, [0, 1], [56, 112], Extrapolation.CLAMP);
    const widthMul = w / 56;
    const fadeIn = interpolate(
      fabRiseTy.value,
      [MEETING_CREATE_FAB_SHADOW_FADE_IN_FROM_TY, 0],
      [0, 1],
      Extrapolation.CLAMP,
    );
    const f = fabFloat.value;
    const floatY = MEETING_CREATE_FAB_IDLE_FLOAT_Y_BASE + (f - 0.5) * MEETING_CREATE_FAB_IDLE_FLOAT_Y_PHASE_MUL;
    const liftY = fabRiseTy.value + floatY;
    const pulse = interpolate(
      liftY,
      [MEETING_CREATE_FAB_SHADOW_PULSE_LIFT_MIN, MEETING_CREATE_FAB_SHADOW_PULSE_LIFT_MAX],
      [MEETING_CREATE_FAB_SHADOW_PULSE_MUL_MIN, MEETING_CREATE_FAB_SHADOW_PULSE_MUL_MAX],
      Extrapolation.CLAMP,
    );
    const baseO = interpolate(p, [0, 1], [0, 0.32], Extrapolation.CLAMP);
    const o = baseO * fadeIn;
    const sx = interpolate(p, [0, 1], [0.45, 1.75], Extrapolation.CLAMP) * widthMul * pulse * fadeIn;
    const sy = interpolate(p, [0, 1], [0.28, 0.32], Extrapolation.CLAMP) * pulse * fadeIn;
    return {
      opacity: o,
      transform: [{ scaleX: sx }, { scaleY: sy }],
    };
  });

  const fabLabelStyle = useAnimatedStyle(() => {
    const pp = fabPillProgress.value;
    return {
      opacity: interpolate(pp, [0.72, 1], [0, 1], Extrapolation.CLAMP),
      maxWidth: interpolate(pp, [0, 1], [0, 160], Extrapolation.CLAMP),
    };
  });

  const fabContentPadStyle = useAnimatedStyle(() => {
    const pp = fabPillProgress.value;
    return {
      paddingHorizontal: interpolate(pp, [0, 1], [0, 14], Extrapolation.CLAMP),
      gap: interpolate(pp, [0, 1], [0, 8], Extrapolation.CLAMP),
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
                  <GinitSymbolicIcon
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

      {showMeetingFab ? (
        <Animated.View
          pointerEvents="box-none"
          style={[
            {
              position: 'absolute',
              right: 18,
              bottom: fabSafeBottom - MEETING_CREATE_FAB_FLOOR_SHADOW_SLOT + MEETING_TAB_CREATE_FAB_LIFT_PX,
              overflow: 'visible',
            },
            fabShellOuterStyle,
          ]}>
          <View style={styles.fabMeetingShadowFloor} pointerEvents="none">
            <Animated.View style={[styles.fabMeetingFloorBlob, fabFloorShadowStyle]} />
          </View>
          <Animated.View
            style={[
              styles.fabMeetingInnerClip,
              { position: 'absolute', bottom: MEETING_CREATE_FAB_FLOOR_SHADOW_SLOT, left: 0 },
              fabMeetingFaceStyle,
            ]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="모임 만들기"
              onPress={onFabPress}
              style={StyleSheet.absoluteFillObject}>
              {({ pressed }) => (
                <View style={[styles.fabMeetingPressFill, pressed && { opacity: 0.86 }]}>
                  <LinearGradient
                    colors={MEETING_CREATE_FAB_GRADIENT_COLORS}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFillObject}
                    pointerEvents="none"
                  />
                  <Animated.View style={[styles.fabMeetingContent, fabContentPadStyle]}>
                    <Image
                      source={MEETING_CREATE_FAB_LOGO}
                      style={styles.fabMeetingLogo}
                      contentFit="contain"
                      accessibilityIgnoresInvertColors
                    />
                    <Animated.View style={[styles.fabLabelWrap, fabLabelStyle]}>
                      <Text style={styles.fabLabelText} numberOfLines={1}>
                        모임 생성
                      </Text>
                    </Animated.View>
                  </Animated.View>
                </View>
              )}
            </Pressable>
          </Animated.View>
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
  fabMeetingShadowFloor: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: MEETING_CREATE_FAB_FLOOR_SHADOW_SLOT + 8,
    alignItems: 'center',
    justifyContent: 'flex-end',
    zIndex: 0,
  },
  fabMeetingFloorBlob: {
    width: MEETING_CREATE_FAB_SHADOW_BLOB,
    height: MEETING_CREATE_FAB_SHADOW_BLOB,
    borderRadius: MEETING_CREATE_FAB_SHADOW_BLOB / 2,
    marginBottom: 0,
    backgroundColor: '#000000',
  },
  fabMeetingInnerClip: {
    overflow: 'hidden',
    zIndex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.deepPurple,
  },
  fabMeetingPressFill: {
    flex: 1,
  },
  fabMeetingContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabMeetingLogo: {
    width: 26,
    height: 26,
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
