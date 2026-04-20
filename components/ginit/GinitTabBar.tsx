import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GinitTheme } from '@/constants/ginit-theme';

const ORDER = ['index', 'map', 'chat', 'profile'] as const;

function iconFor(routeName: string, focused: boolean): keyof typeof Ionicons.glyphMap {
  switch (routeName) {
    case 'index':
      return focused ? 'home' : 'home-outline';
    case 'map':
      return focused ? 'map' : 'map-outline';
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
  const insets = useSafeAreaInsets();
  const routes = ORDER.map((name) => state.routes.find((r) => r.name === name)).filter(Boolean) as (typeof state.routes)[number][];
  const leftRoutes = routes.slice(0, 2);
  const rightRoutes = routes.slice(2);

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
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    const d = new Date();
    const scheduleDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    router.push({
      pathname: '/create/details',
      params: { scheduleDate, scheduleTime: '15:00' },
    });
  };

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]} pointerEvents="box-none">
      <View style={styles.row}>
        <View style={styles.sideGroup}>
          {leftRoutes.map((route) => {
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
                    ? '홈'
                    : route.name === 'map'
                      ? '지도'
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

        {/* 중앙 FAB 고정 공간: 버튼 크기 기준으로 시각적 균형 */}
        <View pointerEvents="none" style={styles.centerGap} />

        <View style={styles.sideGroup}>
          {rightRoutes.map((route) => {
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
                    ? '홈'
                    : route.name === 'map'
                      ? '지도'
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

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="모임 만들기"
        onPress={onFabPress}
        style={[
          styles.fab,
          {
            bottom: Math.max(insets.bottom, 10) + 18,
          },
        ]}>
        <View style={styles.fabInner}>
          <LinearGradient
            colors={GinitTheme.colors.ctaGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.fabBg}
            pointerEvents="none"
          />
          <Ionicons name="add" size={32} color="#FFFFFF" />
        </View>
      </Pressable>
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
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  centerGap: {
    width: 84,
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
    alignSelf: 'center',
    width: 58,
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
    width: 58,
    height: 58,
    borderRadius: 29,
    overflow: 'hidden',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.72)',
  },
  fabBg: {
    ...StyleSheet.absoluteFillObject,
  },
});
