import { StyleSheet, Text, View } from 'react-native';

import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitTheme } from '@/constants/ginit-theme';
import { MAX_MEETING_REVIEW_KEYWORDS } from '@/src/lib/meeting-review/meeting-review-keywords';

type MeetingReviewKeywordChipsProps = {
  keywords: readonly string[];
  selected: readonly string[];
  onToggle: (keyword: string) => void;
  onMaxReached?: () => void;
};

export function MeetingReviewKeywordChips({
  keywords,
  selected,
  onToggle,
  onMaxReached,
}: MeetingReviewKeywordChipsProps) {
  return (
    <View style={styles.wrap}>
      {keywords.map((keyword) => {
        const isSelected = selected.includes(keyword);
        return (
          <GinitPressable
            key={keyword}
            onPress={() => {
              if (!isSelected && selected.length >= MAX_MEETING_REVIEW_KEYWORDS) {
                onMaxReached?.();
                return;
              }
              onToggle(keyword);
            }}
            style={({ pressed }) => [
              styles.chip,
              isSelected && styles.chipSelected,
              pressed && { opacity: 0.9 },
            ]}>
            <Text style={[styles.chipText, isSelected && styles.chipTextSelected]} numberOfLines={1}>
              {keyword}
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
    borderColor: GinitTheme.colors.primary,
    backgroundColor: GinitTheme.colors.primarySoft,
    maxWidth: '100%',
  },
  chipSelected: {
    borderColor: GinitTheme.colors.deepPurple,
    backgroundColor: GinitTheme.colors.noticeSurface,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.primary,
  },
  chipTextSelected: {
    color: GinitTheme.colors.deepPurple,
    fontWeight: '700',
  },
});
