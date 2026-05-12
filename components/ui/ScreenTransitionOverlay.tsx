import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import { useScreenTransition } from '@/src/context/ScreenTransitionContext';

export function ScreenTransitionOverlay() {
  const { active, label } = useScreenTransition();
  if (!active) return null;

  return (
    <View style={styles.overlay} pointerEvents="auto" accessibilityViewIsModal accessibilityLabel={label}>
      <ActivityIndicator color={GinitTheme.colors.primary} size="large" />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: GinitTheme.colors.bg,
  },
  label: {
    color: GinitTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
});
