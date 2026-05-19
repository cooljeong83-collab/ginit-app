import { StyleSheet, Text, View } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import type { MeetingReviewKeywordStat } from '@/src/lib/meeting-review/meeting-review-api';

type MeetingReviewKeywordSummaryBadgesProps = {
  items: readonly MeetingReviewKeywordStat[];
  /** 종합 만족도 하단 등 — 작은 보조 텍스트 톤 */
  compact?: boolean;
};

/** 작성 폼 `MeetingReviewKeywordChips` 선택 상태와 동일한 읽기 전용 배지 */
export function MeetingReviewKeywordSummaryBadges({
  items,
  compact = false,
}: MeetingReviewKeywordSummaryBadgesProps) {
  if (items.length === 0) return null;

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      {items.map((item) => (
        <View key={item.keyword} style={[styles.chip, compact && styles.chipCompact]}>
          <Text style={[styles.chipText, compact && styles.chipTextCompact]} numberOfLines={1}>
            {item.keyword}
            {item.count > 1 ? (
              <Text style={[styles.count, compact && styles.countCompact]}> · {item.count}</Text>
            ) : null}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
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
  chipText: {
    fontSize: 13,
    fontWeight: '700',
    color: GinitTheme.colors.primary,
  },
  count: {
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
  },
  wrapCompact: {
    gap: 6,
    marginTop: 2,
  },
  chipCompact: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderColor: GinitTheme.colors.primary,
    backgroundColor: GinitTheme.colors.primarySoft,
  },
  chipTextCompact: {
    fontSize: 11,
    fontWeight: '600',
    color: GinitTheme.colors.primary,
  },
  countCompact: {
    fontWeight: '500',
    fontSize: 11,
  },
});
