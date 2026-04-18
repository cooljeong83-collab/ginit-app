import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
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
        ? GinitTheme.trustBlue
        : isDark
          ? '#F4F6F8'
          : '#0B1220';

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
          styles.pressable,
          variant === 'ghost' && styles.ghostShell,
          state.pressed && !disabled && styles.pressed,
          disabled && styles.disabled,
          resolved,
        ];
      }}
      {...rest}>
      {variant !== 'ghost' ? (
        <View style={styles.clip}>
          {Platform.OS === 'web' ? (
            <View style={[StyleSheet.absoluteFill, webBlurLayer(variant, isDark)]} />
          ) : (
            <BlurView
              intensity={variant === 'primary' ? GinitTheme.blur.intensity : GinitTheme.blur.intensity - 8}
              tint={variant === 'primary' ? 'dark' : tint}
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
    return { backgroundColor: 'rgba(0, 82, 204, 0.82)' };
  }
  return { backgroundColor: isDark ? 'rgba(40, 48, 58, 0.75)' : 'rgba(255, 255, 255, 0.5)' };
}

function colorOverlay(variant: GinitButtonVariant, isDark: boolean): ViewStyle {
  if (variant === 'primary') {
    return { backgroundColor: 'rgba(0, 82, 204, 0.38)' };
  }
  return {
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.28)',
  };
}

function ghostBorder(isDark: boolean): ViewStyle {
  return {
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: isDark ? 'rgba(0, 82, 204, 0.55)' : 'rgba(0, 82, 204, 0.45)',
    backgroundColor: isDark ? 'rgba(0, 82, 204, 0.08)' : 'rgba(0, 82, 204, 0.06)',
  };
}

const styles = StyleSheet.create({
  pressable: {
    borderRadius: GinitTheme.radius.button,
    overflow: 'hidden',
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
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  pressed: {
    opacity: 0.92,
    transform: [{ scale: 0.98 }],
  },
  disabled: {
    opacity: 0.45,
  },
});
