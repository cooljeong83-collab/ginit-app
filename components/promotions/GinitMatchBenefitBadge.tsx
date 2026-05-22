import { StyleSheet, Text, View } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';

type Props = {
  label: string;
  compact?: boolean;
  /** 모임 목록 등 — 배지 뒤 연한 퍼플 박스 없이 텍스트만 */
  plain?: boolean;
  /** 썸네일 좌상단 오버레이 — 작은 라벨, 흰 배경 */
  overlay?: boolean;
};

/** 플랫 라운드 스퀘어 배지 — shadow 없음 */
export function GinitMatchBenefitBadge({ label, compact, plain, overlay }: Props) {
  const text = label.trim() || '지닛 매치 추천';
  return (
    <View
      style={[
        s.badge,
        compact && s.badgeCompact,
        plain && s.badgePlain,
        overlay && s.badgeOverlay,
      ]}
      accessibilityLabel={text}>
      <Text
        style={[s.text, compact && s.textCompact, plain && s.textPlain, overlay && s.textOverlay]}
        numberOfLines={1}>
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
  badgePlain: {
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderRadius: 0,
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
    color: GinitTheme.colors.primary,
  },
  textCompact: {
    fontSize: 11,
  },
  textPlain: {
    color: GinitTheme.colors.deepPurple,
    letterSpacing: -0.2,
  },
  badgeOverlay: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    maxWidth: 64,
  },
  textOverlay: {
    fontSize: 9,
    lineHeight: 12,
    color: GinitTheme.colors.deepPurple,
    letterSpacing: -0.2,
  },
});
