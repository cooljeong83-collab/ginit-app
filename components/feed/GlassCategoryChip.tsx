import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View, Platform } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';

type Props = {
  label: string;
  active: boolean;
  onPress: () => void;
  maxLabelWidth: number;
  /** 미지정 시 「{label} 카테고리 필터」 */
  accessibilityLabel?: string;
};

/**
 * 홈 피드 상단 카테고리 필터와 동일한 글래스 칩 (채팅 탭 미니 카드 등에서 재사용)
 */
export function GlassCategoryChip({ label, active, onPress, maxLabelWidth, accessibilityLabel }: Props) {
  const a11yLabel = accessibilityLabel ?? `${label} 카테고리 필터`;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.chipPressable,
        { maxWidth: maxLabelWidth },
        pressed && !active && styles.chipPressed,
      ]}>
      <View style={[styles.chipClip, active && styles.chipClipActive]}>
        {!active ? (
          <>
            {Platform.OS === 'android' ? (
              <View style={[StyleSheet.absoluteFillObject, styles.chipAndroidFrost]} />
            ) : Platform.OS === 'web' ? (
              <View style={[StyleSheet.absoluteFillObject, styles.chipWebFrost]} />
            ) : (
              <BlurView
                intensity={GinitTheme.glassModal.blurIntensity}
                tint="light"
                style={StyleSheet.absoluteFillObject}
                experimentalBlurMethod="dimezisBlurView"
              />
            )}
            <View style={[StyleSheet.absoluteFillObject, styles.chipVeil]} pointerEvents="none" />
            <View style={[StyleSheet.absoluteFillObject, styles.chipInnerBorder]} pointerEvents="none" />
          </>
        ) : (
          <>
            <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
              <LinearGradient
                colors={GinitTheme.colors.ctaGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />
            </View>
            <View style={[StyleSheet.absoluteFillObject, styles.chipActiveVeil]} pointerEvents="none" />
            <View style={[StyleSheet.absoluteFillObject, styles.chipInnerBorder]} pointerEvents="none" />
          </>
        )}
        <View style={styles.chipLabelRow}>
          <Text
            style={[styles.chipGlassLabel, active && styles.chipGlassLabelActive, { maxWidth: maxLabelWidth - 28 }]}
            numberOfLines={1}>
            {label}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chipPressable: {
    borderRadius: 20,
    minWidth: 72,
  },
  chipPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.98 }],
  },
  chipClip: {
    borderRadius: 16,
    overflow: 'hidden',
    paddingHorizontal: 12,
    /** 홈 피드 `categoryDropdown`(paddingVertical 10 + 13pt 라벨)과 동일한 터치·시각 높이 */
    paddingVertical: 10,
    justifyContent: 'center',
    minHeight: 38,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 1,
  },
  chipClipActive: {
    borderColor: 'rgba(31, 42, 68, 0.55)',
    shadowColor: 'rgba(31, 42, 68, 0.22)',
    shadowOpacity: 0.22,
  },
  chipAndroidFrost: {
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
  },
  chipWebFrost: {
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
  },
  chipVeil: {
    backgroundColor: GinitTheme.glass.overlayLight,
  },
  chipActiveVeil: {
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
  },
  chipInnerBorder: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.45)',
    borderRadius: 16,
  },
  chipLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: '100%',
  },
  chipGlassLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
    lineHeight: 18,
  },
  chipGlassLabelActive: {
    color: '#FFFFFF',
  },
});
