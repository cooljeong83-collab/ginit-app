import { BlurView } from 'expo-blur';
import { Platform, StyleSheet, View, type ViewProps } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type GinitCardProps = ViewProps & {
  /**
   * `light`: 시스템 다크 모드에서도 밝은 글래스만 사용(모임 등록 상세 입력 베이스 카드 등).
   * 기본 `auto`는 시스템에 따라 라이트/다크 셸을 전환합니다.
   */
  appearance?: 'auto' | 'light';
};

/**
 * 반투명 + 블러 글래스 카드.
 * 라이트: 장소 검색 모달과 동일한 밝은 글래스(`rgba(255,255,255,0.7)` 근사 + 연한 테두리).
 * 다크: 기존 톤 유지.
 */
export function GinitCard({ style, children, appearance = 'auto', ...rest }: GinitCardProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = appearance === 'light' ? false : colorScheme === 'dark';

  if (isDark) {
    const tint = 'dark' as const;
    const webFallback = 'rgba(28, 32, 40, 0.72)';

    return (
      <View
        style={[
          styles.shellDark,
          {
            borderColor: GinitTheme.glass.borderDark,
            shadowColor: GinitTheme.glass.shadow,
          },
          style,
        ]}
        {...rest}>
        {Platform.OS === 'web' ? (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: webFallback }]} />
        ) : (
          <BlurView intensity={GinitTheme.blur.intensityStrong} tint={tint} style={StyleSheet.absoluteFill} />
        )}
        <View
          style={[styles.tint, { backgroundColor: GinitTheme.glass.overlayDark }]}
          pointerEvents="none"
        />
        <View style={styles.content}>{children}</View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.shellLight,
        {
          borderColor: GinitTheme.colors.border,
          shadowColor: GinitTheme.shadow.card.shadowColor,
        },
        style,
      ]}
      {...rest}>
      {Platform.OS === 'web' ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: GinitTheme.colors.surface }]} />
      ) : (
        <>
          <BlurView
            intensity={GinitTheme.glassModal.blurIntensity}
            tint="light"
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: GinitTheme.colors.surface }]}
          />
        </>
      )}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  shellDark: {
    borderRadius: GinitTheme.radius.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 6,
  },
  shellLight: {
    borderRadius: GinitTheme.radius.card,
    borderWidth: 1,
    overflow: 'hidden',
    shadowOffset: GinitTheme.shadow.card.shadowOffset,
    shadowOpacity: GinitTheme.shadow.card.shadowOpacity,
    shadowRadius: GinitTheme.shadow.card.shadowRadius,
    elevation: GinitTheme.shadow.card.elevation,
  },
  tint: {
    ...StyleSheet.absoluteFillObject,
  },
  content: {
    padding: GinitTheme.spacing.lg,
  },
});
