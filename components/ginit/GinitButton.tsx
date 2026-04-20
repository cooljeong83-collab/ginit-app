import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type GinitButtonVariant = 'primary' | 'secondary' | 'ghost';

export type GinitButtonProps = Omit<PressableProps, 'children'> & {
  title: string;
  variant?: GinitButtonVariant;
  textStyle?: StyleProp<TextStyle>;
};

/**
 * 글래스모피즘 스타일 버튼. primary는 Trust Blue 톤을 포인트로 사용합니다.
 */
export function GinitButton({
  title,
  variant = 'primary',
  style: containerStyle,
  textStyle,
  onPress,
  disabled,
  ...rest
}: GinitButtonProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';
  const tint = isDark ? 'dark' : 'light';

  const labelColor =
    variant === 'primary'
      ? '#FFFFFF'
      : variant === 'ghost'
        ? GinitTheme.colors.primary
        : isDark
          ? '#F4F6F8'
          : GinitTheme.colors.text;

  const handlePress: PressableProps['onPress'] = (e) => {
    if (!disabled && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress?.(e);
  };

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={handlePress}
      style={(state: PressableStateCallbackType) => {
        const resolved =
          typeof containerStyle === 'function' ? containerStyle(state) : containerStyle;
        return [
          styles.pressableWrap,
          variant === 'ghost' && styles.ghostShell,
          state.pressed && !disabled && styles.pressed,
          disabled && styles.disabled,
          variant === 'primary' && styles.primaryShadow,
          resolved,
        ];
      }}
      {...rest}>
      {variant !== 'ghost' ? (
        <View style={styles.clip}>
          {variant === 'primary' ? (
            <LinearGradient
              colors={GinitTheme.colors.ctaGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
          ) : Platform.OS === 'web' ? (
            <View style={[StyleSheet.absoluteFill, webBlurLayer(variant, isDark)]} />
          ) : (
            <BlurView
              intensity={GinitTheme.blur.intensity - 8}
              tint={tint}
              style={StyleSheet.absoluteFill}
            />
          )}

          <View style={[StyleSheet.absoluteFill, colorOverlay(variant, isDark)]} pointerEvents="none" />
          <Text style={[styles.label, { color: labelColor }, textStyle]}>{title}</Text>
        </View>
      ) : (
        <View style={[styles.clip, styles.ghostInner, ghostBorder(isDark)]}>
          <Text style={[styles.label, { color: labelColor }, textStyle]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

function webBlurLayer(variant: GinitButtonVariant, isDark: boolean): ViewStyle {
  if (variant === 'primary') {
    return { backgroundColor: 'rgba(255, 255, 255, 0.0)' };
  }
  return { backgroundColor: isDark ? 'rgba(40, 48, 58, 0.75)' : 'rgba(255, 255, 255, 0.62)' };
}

function colorOverlay(variant: GinitButtonVariant, isDark: boolean): ViewStyle {
  if (variant === 'primary') {
    return {
      backgroundColor: 'rgba(255, 255, 255, 0.10)',
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.72)',
    };
  }
  return {
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.28)',
  };
}

function ghostBorder(isDark: boolean): ViewStyle {
  return {
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: isDark ? 'rgba(134, 211, 183, 0.55)' : 'rgba(134, 211, 183, 0.45)',
    backgroundColor: isDark ? 'rgba(134, 211, 183, 0.10)' : 'rgba(134, 211, 183, 0.08)',
  };
}

const styles = StyleSheet.create({
  pressableWrap: {
    borderRadius: GinitTheme.radius.button,
  },
  primaryShadow: {
    shadowColor: GinitTheme.glass.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 1,
    shadowRadius: 22,
    elevation: 10,
  },
  ghostShell: {
    overflow: 'visible',
  },
  clip: {
    borderRadius: GinitTheme.radius.button,
    overflow: 'hidden',
    paddingVertical: 14,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  ghostInner: {
    backgroundColor: 'transparent',
  },
  label: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.1,
  },
  pressed: {
    opacity: 0.92,
    transform: [{ scale: 0.98 }],
  },
  disabled: {
    opacity: 0.45,
  },
});
