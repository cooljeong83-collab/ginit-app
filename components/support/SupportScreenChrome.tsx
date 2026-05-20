import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GinitPressable } from '@/components/ui/GinitPressable';
import { ScreenShell } from '@/components/ui';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { supportScreenStyles as styles } from '@/components/support/supportScreenStyles';

export type SupportScreenChromeProps = {
  title: string;
  onBack: () => void;
  children: ReactNode;
};

export function SupportScreenChrome({ title, onBack, children }: SupportScreenChromeProps) {
  return (
    <ScreenShell padded={false} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <GinitPressable
            onPress={onBack}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="뒤로"
            style={styles.backBtn}>
            <GinitSymbolicIcon name="chevron-back" size={22} color="#0f172a" />
          </GinitPressable>
          <Text style={styles.topTitle} numberOfLines={1}>
            {title}
          </Text>
          <View style={styles.topBarSpacer} />
        </View>
        {children}
      </SafeAreaView>
    </ScreenShell>
  );
}
