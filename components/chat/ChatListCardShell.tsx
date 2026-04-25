import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';

type Props = {
  accentGradient: readonly [string, string];
  onPress: () => void;
  accessibilityLabel: string;
  children: ReactNode;
};

/**
 * 홈 피드 카드와 같은 외곽(그림자·보더·좌측 액센트), 내부는 채팅 목록용 흰색 배경.
 */
export function ChatListCardShell({ accentGradient, onPress, accessibilityLabel, children }: Props) {
  return (
    <View style={styles.meetRowWrap}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={styles.pressable}>
        <View style={styles.cardShadow}>
          <View style={styles.cardShell}>
            <LinearGradient
              colors={[...accentGradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.accentStripe}
            />
            <View style={styles.cardInner}>{children}</View>
          </View>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  meetRowWrap: {
    marginBottom: 10,
    borderRadius: GinitTheme.radius.card,
    backgroundColor: Platform.OS === 'android' ? GinitTheme.colors.surfaceStrong : 'transparent',
    ...GinitTheme.shadow.card,
  },
  pressable: {
    borderRadius: GinitTheme.radius.card,
    overflow: 'hidden',
  },
  cardShadow: {
    borderRadius: GinitTheme.radius.card,
    backgroundColor: GinitTheme.colors.surfaceStrong,
  },
  cardShell: {
    borderRadius: GinitTheme.radius.card,
    overflow: 'hidden',
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    alignSelf: 'stretch',
  },
  accentStripe: {
    width: 4,
    alignSelf: 'stretch',
  },
  cardInner: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 10,
    paddingHorizontal: 12,
    paddingLeft: 10,
    gap: 6,
    backgroundColor: GinitTheme.colors.surfaceStrong,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: GinitTheme.colors.border,
  },
});
