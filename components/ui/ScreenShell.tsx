import { useMemo } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';

export type ScreenShellProps = ViewProps & {
  padded?: boolean;
};

/**
 * 화면 루트 공통 래퍼.
 * - 배경색/세이프에어리어/기본 패딩을 일관성 있게 적용합니다.
 */
export function ScreenShell({ padded = true, style, children, ...rest }: ScreenShellProps) {
  const contentStyle = useMemo(() => {
    return [styles.root, padded && styles.padded, style];
  }, [padded, style]);

  return (
    <View style={contentStyle} {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: GinitTheme.colors.bg,
  },
  padded: {
    paddingHorizontal: GinitTheme.spacing.lg,
  },
});

