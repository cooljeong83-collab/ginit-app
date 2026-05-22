import { usePathname, useSegments } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getMeetingTabFabTouchShieldScreenStyle } from '@/components/create/meetingCreateFabShared';
import { GinitPressable } from '@/components/ui/GinitPressable';
import { requestMeetingTabCreateFabPress } from '@/src/lib/meeting-tab-create-fab-press-bridge';

function useMeetingTabFabShieldVisible(): boolean {
  const pathname = usePathname();
  const segments = useSegments();
  if (pathname.includes('/create')) return false;
  if (segments[0] !== '(tabs)') return false;
  if (segments.length === 1) return true;
  return segments[1] === 'index';
}

/**
 * Android — `NativeAdView`가 탭바 FAB보다 터치를 먼저 받는 경우,
 * 탭 네비·광고 위에 투명 히트 영역을 올려 모임 생성으로 연결합니다.
 */
export function MeetingTabCreateFabTouchShield() {
  const insets = useSafeAreaInsets();
  const visible = useMeetingTabFabShieldVisible();

  if (Platform.OS !== 'android' || !visible) return null;

  return (
    <GinitPressable
      accessibilityRole="button"
      accessibilityLabel="모임 만들기"
      onPress={requestMeetingTabCreateFabPress}
      style={[styles.shield, getMeetingTabFabTouchShieldScreenStyle(insets.bottom)]}
    />
  );
}

const styles = StyleSheet.create({
  shield: {
    backgroundColor: 'transparent',
  },
});
