import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

/**
 * 모임 생성 마법사 `wizardPrimaryBtn` — 네온 그라데이션 CTA와 동일 스타일입니다.
 */
export function NeonConfirmButton({ label, onPress, disabled }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        disabled && styles.btnDisabled,
        pressed && !disabled && styles.btnPressed,
      ]}
      accessibilityRole="button">
      <View pointerEvents="none" style={styles.btnBg}>
        <LinearGradient
          colors={GinitTheme.colors.ctaGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
      </View>
      <Text style={styles.btnLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    alignSelf: 'stretch',
    marginTop: 12,
    borderRadius: 16,
    overflow: 'hidden',
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.72)',
    shadowColor: GinitTheme.glass.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 14,
    elevation: 8,
  },
  btnDisabled: { opacity: 0.45 },
  btnPressed: { opacity: 0.92 },
  btnBg: {
    ...StyleSheet.absoluteFillObject,
  },
  btnLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
