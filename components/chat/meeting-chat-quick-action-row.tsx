
import { type ComponentProps, useCallback, useEffect, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';

import { meetingChatBodyStyles as styles } from '@/components/chat/meeting-chat-body-styles';
import { GinitTheme } from '@/constants/ginit-theme';
import { GinitSymbolicIcon, type SymbolicIconName } from '@/components/ui/GinitSymbolicIcon';

const PLUS_QUICK_ROW_H = 50;
const PLUS_QUICK_ICON = 22;
const PLUS_QUICK_PAD_X = 14;
const PLUS_QUICK_ICON_LABEL_GAP = 8;
const PLUS_QUICK_BORDER_RADIUS = PLUS_QUICK_ROW_H / 2;
const PLUS_QUICK_PILL_EXTRA_W = 12;
const PLUS_QUICK_PILL_BG = 'rgba(31, 42, 68, 0.8)';

function estimateQuickLabelPx(label: string): number {
  if (!label) return 24;
  return [...label].reduce((acc, ch) => acc + ((ch.codePointAt(0) ?? 0) > 0x007f ? 15 : 9), 0);
}

export type MeetingChatQuickActionDef = {
  key: string;
  label: string;
  icon: SymbolicIconName;
  onPress: () => void;
};

export function MeetingChatQuickActionRow({
  action,
  progress,
  pillMaxW,
}: {
  action: MeetingChatQuickActionDef;
  progress: Animated.Value;
  pillMaxW: number;
}) {
  const p = progress;
  const basePillContentW = (textPx: number) =>
    PLUS_QUICK_PAD_X + PLUS_QUICK_ICON + PLUS_QUICK_ICON_LABEL_GAP + textPx + PLUS_QUICK_PAD_X + PLUS_QUICK_PILL_EXTRA_W;

  const [pillTargetW, setPillTargetW] = useState(() =>
    Math.min(pillMaxW, Math.max(PLUS_QUICK_ROW_H, basePillContentW(estimateQuickLabelPx(action.label)))),
  );

  useEffect(() => {
    setPillTargetW(
      Math.min(pillMaxW, Math.max(PLUS_QUICK_ROW_H, basePillContentW(estimateQuickLabelPx(action.label)))),
    );
  }, [action.label, pillMaxW]);

  const onMeasureLabelTextLayout = useCallback(
    (e: { nativeEvent: { lines: { width: number }[] } }) => {
      const tw = e.nativeEvent.lines[0]?.width;
      if (tw == null || !Number.isFinite(tw)) return;
      const total = Math.ceil(basePillContentW(tw));
      setPillTargetW((prev) => {
        const next = Math.min(pillMaxW, Math.max(PLUS_QUICK_ROW_H, total));
        return prev === next ? prev : next;
      });
    },
    [pillMaxW],
  );

  const rowLift = p.interpolate({
    inputRange: [0, 1],
    outputRange: [20, 0],
    extrapolate: 'clamp',
  });
  const rowOp = p.interpolate({
    inputRange: [0, 0.14, 0.62],
    outputRange: [0, 1, 1],
    extrapolate: 'clamp',
  });
  const rowScale = p.interpolate({
    inputRange: [0, 1],
    outputRange: [0.93, 1],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      style={{
        marginBottom: 10,
        alignSelf: 'flex-start',
        opacity: rowOp,
        transform: [{ translateY: rowLift }, { scale: rowScale }],
      }}>
      <View
        style={[styles.plusQuickMeasureHost, { width: pillMaxW }]}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <Text style={styles.plusFanLabelMorph} onTextLayout={onMeasureLabelTextLayout} numberOfLines={1}>
          {action.label}
        </Text>
      </View>
      <Pressable
        onPress={action.onPress}
        accessibilityRole="button"
        accessibilityLabel={action.label}
        hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}>
        <View
          style={{
            width: pillTargetW,
            minWidth: PLUS_QUICK_ROW_H,
            height: PLUS_QUICK_ROW_H,
            borderRadius: PLUS_QUICK_BORDER_RADIUS,
            backgroundColor: 'transparent',
            ...GinitTheme.shadow.float,
          }}>
          <View
            style={{
              width: '100%',
              height: '100%',
              borderRadius: PLUS_QUICK_BORDER_RADIUS,
              overflow: 'hidden',
              borderWidth: 0,
              backgroundColor: PLUS_QUICK_PILL_BG,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: PLUS_QUICK_PAD_X,
            }}>
            <View style={styles.plusQuickIconLabelRow}>
              <GinitSymbolicIcon name={action.icon} size={PLUS_QUICK_ICON} color="#FFFFFF" />
              <Text style={styles.plusFanLabelMorph} numberOfLines={1}>
                {action.label}
              </Text>
            </View>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}
