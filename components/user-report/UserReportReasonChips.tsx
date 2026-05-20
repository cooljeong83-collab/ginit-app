import { StyleSheet, Text, View } from 'react-native';

import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitTheme } from '@/constants/ginit-theme';
import type { UserReportReasonCode } from '@/src/features/user-report/user-report-reasons';
import { USER_REPORT_REASONS } from '@/src/features/user-report/user-report-reasons';

type UserReportReasonChipsProps = {
  selected: UserReportReasonCode | null;
  onSelect: (code: UserReportReasonCode) => void;
};

export function UserReportReasonChips({ selected, onSelect }: UserReportReasonChipsProps) {
  return (
    <View style={styles.wrap}>
      {USER_REPORT_REASONS.map((reason) => {
        const isSelected = selected === reason.code;
        return (
          <GinitPressable
            key={reason.code}
            onPress={() => onSelect(reason.code)}
            style={({ pressed }) => [
              styles.chip,
              isSelected && styles.chipSelected,
              pressed && { opacity: 0.9 },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={reason.label}>
            <Text style={[styles.chipText, isSelected && styles.chipTextSelected]} numberOfLines={1}>
              {reason.label}
            </Text>
          </GinitPressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
    maxWidth: '100%',
  },
  chipSelected: {
    borderColor: GinitTheme.colors.deepPurple,
    backgroundColor: GinitTheme.colors.noticeSurface,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.textSub,
  },
  chipTextSelected: {
    color: GinitTheme.colors.deepPurple,
    fontWeight: '700',
  },
});
