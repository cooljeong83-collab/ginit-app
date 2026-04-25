import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import { useInAppAlarms } from '@/src/context/InAppAlarmsContext';

type Props = {
  accessibilityLabel?: string;
};

export function InAppAlarmsBellButton({ accessibilityLabel = '새 소식' }: Props) {
  const { hasUnread, openAlarmPanel } = useInAppAlarms();

  return (
    <Pressable
      onPress={openAlarmPanel}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={10}
      style={styles.bellWrap}>
      <Ionicons name="notifications-outline" size={24} color="#0f172a" />
      {hasUnread ? <View style={styles.badge} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bellWrap: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF8A00',
    borderWidth: 1,
    borderColor: '#fff',
  },
});
