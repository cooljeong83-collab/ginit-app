import { forwardRef } from 'react';
import { Platform, StyleSheet, TextInput, type TextInputProps, View } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';

type Props = TextInputProps & {
  /** 모임 채팅 입력창과 같은 래퍼 패딩 */
  dense?: boolean;
};

/**
 * 모임 상세·채팅 composer와 맞춘 글래스 입력 필드입니다.
 */
export const GlassInput = forwardRef<TextInput, Props>(function GlassInput({ style, dense, ...rest }, ref) {
  return (
    <View style={[styles.shell, dense && styles.shellDense]}>
      <TextInput
        ref={ref}
        placeholderTextColor="#94a3b8"
        {...rest}
        style={[styles.input, style]}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    minHeight: 44,
    borderRadius: 22,
    paddingHorizontal: 14,
    justifyContent: 'center',
    backgroundColor: GinitTheme.glassModal.inputFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  shellDense: {
    minHeight: 40,
    borderRadius: 18,
    paddingHorizontal: 12,
  },
  input: {
    fontSize: 15,
    fontWeight: '600',
    color: GinitTheme.colors.text,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
  },
});
