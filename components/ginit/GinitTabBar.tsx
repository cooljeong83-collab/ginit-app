import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
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
    router.push('/create');
  };

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]} pointerEvents="box-none">
      <View style={styles.row}>
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
                  ? '홈'
                  : route.name === 'map'
                    ? '지도'
                    : route.name === 'chat'
                      ? '채팅'
                      : '프로필';

          const isLeftPair = route.name === 'index' || route.name === 'map';

          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              onPress={() => onTabPress(route, originalIndex)}
              style={[styles.tab, isLeftPair ? styles.tabLeft : styles.tabRight]}>
              <Ionicons name={iconFor(route.name, focused)} size={24} color={focused ? GinitTheme.trustBlue : '#94A3B8'} />
              <Text style={[styles.tabLabel, focused && styles.tabLabelActive]} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
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
        <Ionicons name="add" size={32} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(15, 23, 42, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: 8,
    minHeight: 52,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  tabLeft: {
    marginRight: 20,
  },
  tabRight: {
    marginLeft: 20,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
  },
  tabLabelActive: {
    color: GinitTheme.trustBlue,
  },
  fab: {
    position: 'absolute',
    alignSelf: 'center',
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: GinitTheme.pointOrange,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: GinitTheme.pointOrange,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 10,
  },
});
