import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon, type SymbolicIconName } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import {
  resolveBottomBarDisplayLabel,
  type MeetingDetailBottomAction,
  type MeetingDetailBottomLabelMode,
  type MeetingDetailBottomPillVariant,
} from '@/src/lib/meeting-detail-bottom-bar';
import { ActivityIndicator, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

export type MeetingDetailBottomPillProps = {
  action: MeetingDetailBottomAction;
  mode: MeetingDetailBottomLabelMode;
  flexGrow?: number;
  minWidth?: number;
  /** 참여자 행: 16px 아이콘·12px 라벨 */
  compactTypography?: boolean;
};

function variantBackground(variant: MeetingDetailBottomPillVariant): string {
  switch (variant) {
    case 'blue':
      return GinitTheme.colors.textSub;
    case 'orange':
      return GinitTheme.pointOrange;
    case 'danger':
      return '#DC2626';
    case 'purple':
      return GinitTheme.colors.deepPurple;
  }
}

export function MeetingDetailBottomPill({
  action,
  mode,
  flexGrow = 1,
  minWidth,
  compactTypography = false,
}: MeetingDetailBottomPillProps) {
  const iconSize = compactTypography ? 16 : 18;
  const displayLabel = resolveBottomBarDisplayLabel(action, mode);
  const iconOnly = mode === 'iconOnly';
  const disabled = action.disabled || action.busy;
  const iconColor = action.iconColor ?? '#fff';

  return (
    <GinitPressable
      onPress={action.onPress}
      disabled={disabled}
      style={({ pressed }) => {
        const base: StyleProp<ViewStyle> = [
          styles.bottomPill,
          iconOnly ? styles.bottomIconPill : [styles.bottomPillFlex, styles.bottomPillLabeled],
          {
            flexGrow,
            flexShrink: 1,
            flexBasis: 0,
            minWidth: minWidth ?? (iconOnly ? 44 : 0),
          },
          { backgroundColor: variantBackground(action.variant) },
          action.mutedOpacity != null ? { opacity: action.mutedOpacity } : null,
          disabled && action.mutedOpacity == null ? { opacity: 0.75 } : null,
          pressed && !disabled && action.mutedOpacity == null ? { opacity: 0.88 } : null,
        ];
        return base;
      }}
      accessibilityRole="button"
      accessibilityLabel={action.a11yLabel}
      accessibilityState={{ disabled: Boolean(disabled) }}>
      {action.busy ? (
        <ActivityIndicator color="#fff" size="small" />
      ) : (
        <GinitSymbolicIcon name={action.icon as SymbolicIconName} size={iconSize} color={iconColor} />
      )}
      {!iconOnly && displayLabel ? (
        <Text
          style={[
            styles.pillText,
            compactTypography ? styles.pillTextCompact : null,
            action.labelOnOrange ? styles.pillTextOnOrange : null,
            styles.bottomPillLabel,
          ]}
          numberOfLines={1}
          ellipsizeMode="tail">
          {displayLabel}
        </Text>
      ) : null}
    </GinitPressable>
  );
}

export const meetingDetailBottomPillStyles = StyleSheet.create({
  bottomBarEqualRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    minWidth: 0,
  },
  bottomPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 16,
    paddingVertical: 13,
    minHeight: 50,
    borderRadius: 999,
  },
  bottomPillLabeled: {
    paddingHorizontal: 12,
  },
  bottomIconPill: {
    height: 50,
    minHeight: 50,
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderRadius: 25,
  },
  bottomPillFlex: { minWidth: 0 },
  bottomPillLabel: {
    flexShrink: 1,
    minWidth: 26,
    textAlign: 'center',
  },
  pillText: { color: '#fff', fontWeight: '700', fontSize: 14, lineHeight: 18 },
  pillTextOnOrange: { color: GinitTheme.colors.texWhite },
  pillTextCompact: { fontSize: 12, lineHeight: 16 },
});

const styles = meetingDetailBottomPillStyles;
