
import { Pressable, StyleSheet, View } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import { useInAppAlarms } from '@/src/context/InAppAlarmsContext';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';

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
      <GinitSymbolicIcon name="notifications-outline" size={22} color="#0f172a" />
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
    backgroundColor: GinitTheme.themeMainColor,
    borderWidth: 1,
    borderColor: '#fff',
  },
});
