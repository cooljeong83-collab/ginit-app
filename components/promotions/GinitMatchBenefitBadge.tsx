import { StyleSheet, Text, View } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';

type Props = {
  label: string;
  compact?: boolean;
};

/** 플랫 라운드 스퀘어 배지 — shadow 없음 */
export function GinitMatchBenefitBadge({ label, compact }: Props) {
  const text = label.trim() || '지닛 매치 추천';
  return (
    <View style={[s.badge, compact && s.badgeCompact]} accessibilityLabel={text}>
      <Text style={[s.text, compact && s.textCompact]} numberOfLines={1}>
        💜 {text}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: GinitTheme.colors.primarySoft,
  },
  badgeCompact: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
    color: GinitTheme.colors.primary,
  },
  textCompact: {
    fontSize: 11,
  },
});
