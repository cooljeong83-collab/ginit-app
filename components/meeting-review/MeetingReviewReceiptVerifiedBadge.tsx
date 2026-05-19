import { StyleSheet, Text, View } from 'react-native';

import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';

export function MeetingReviewReceiptVerifiedBadge() {
  return (
    <View style={styles.wrap} accessibilityRole="text" accessibilityLabel="영수증 인증됨">
      <GinitSymbolicIcon name="shield-checkmark-outline" size={14} color={GinitTheme.colors.deepPurple} />
      <Text style={styles.label}>영수증 인증</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: GinitTheme.colors.noticeSurface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.primary,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: GinitTheme.colors.deepPurple,
  },
});
