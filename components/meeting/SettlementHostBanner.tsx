import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { StyleSheet, Text, View } from 'react-native';

type SettlementHostBannerCommon = {
  onPress: () => void;
  accessibilityLabel?: string;
  /** 상단 구분선 생략(가로 공지 페이저 등에서 외곽에서만 구분할 때) */
  hideTopBorder?: boolean;
  /** 좌우 반원 캡슐(홈·상단 페이저 슬라이드) */
  pillCapsule?: boolean;
  /** 페이저 슬라이드 폭 100%·좌우·상하 마진 없음(트랙에 맞춤) */
  slideTrackFullBleed?: boolean;
};

/** `quotedMeetingTitle`+`ctaSuffix` 사용 시 `「제목」`만 말줄임, CTA 문구는 한 줄 전체 노출 */
export type SettlementHostBannerProps = SettlementHostBannerCommon &
  ({ label: string; quotedMeetingTitle?: never; ctaSuffix?: never } | { quotedMeetingTitle: string; ctaSuffix: string; label?: never });

/**
 * 호스트 전용 정산 CTA — 상세·채팅·홈에서 공통 사용. opacity 눌림만(스케일·글로우 없음).
 */
export function SettlementHostBanner(props: SettlementHostBannerProps) {
  const {
    onPress,
    accessibilityLabel,
    hideTopBorder,
    pillCapsule,
    slideTrackFullBleed,
  } = props;
  const label = 'label' in props ? props.label : undefined;
  const quotedMeetingTitle = 'quotedMeetingTitle' in props ? props.quotedMeetingTitle : undefined;
  const ctaSuffix = 'ctaSuffix' in props ? props.ctaSuffix : undefined;
  const useSplitTitle = quotedMeetingTitle != null && ctaSuffix != null;
  const a11yLabel =
    accessibilityLabel ??
    (useSplitTitle ? `「${quotedMeetingTitle}」${ctaSuffix}` : label ?? '정산하기');

  const wrapStyle = pillCapsule
    ? [
        styles.wrapPill,
        styles.wrapPillStretch,
        slideTrackFullBleed && styles.wrapPillFullBleed,
      ]
    : [styles.wrap, hideTopBorder && styles.wrapNoTopBorder];
  return (
    <View style={wrapStyle}>
      <GinitPressable
        onPress={onPress}
        style={({ pressed }) => [styles.row, pillCapsule && styles.rowFill, pressed && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}>
        <GinitSymbolicIcon name="wallet-outline" size={18} color={GinitTheme.colors.primary} />
        {useSplitTitle ? (
          <View style={styles.labelSplit}>
            <Text style={styles.labelTitle} numberOfLines={1} ellipsizeMode="tail">
              {`「${quotedMeetingTitle}」`}
            </Text>
            <Text style={styles.labelCta} numberOfLines={1}>
              {ctaSuffix}
            </Text>
          </View>
        ) : (
          <Text style={styles.label} numberOfLines={1} ellipsizeMode="tail">
            {label}
          </Text>
        )}
        <GinitSymbolicIcon name="chevron-forward" size={18} color={GinitTheme.colors.textMuted} />
      </GinitPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GinitTheme.colors.border,
    backgroundColor: GinitTheme.colors.noticeSurface,
  },
  wrapNoTopBorder: { borderTopWidth: 0 },
  wrapPill: {
    marginHorizontal: 12,
    marginVertical: 6,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: GinitTheme.colors.noticeSurface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  wrapPillStretch: { alignSelf: 'stretch' },
  wrapPillFullBleed: {
    marginHorizontal: 0,
    marginVertical: 0,
    width: '100%',
    borderRadius: 0,
  },
  rowFill: { width: '100%' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  rowPressed: { opacity: 0.85 },
  label: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.text,
  },
  labelSplit: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  labelTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.text,
  },
  labelCta: {
    flexShrink: 0,
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.text,
  },
});
