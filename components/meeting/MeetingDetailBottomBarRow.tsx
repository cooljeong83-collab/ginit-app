import { MeetingDetailBottomPill, meetingDetailBottomPillStyles } from '@/components/meeting/MeetingDetailBottomPill';
import {
  computeBottomBarPillLayouts,
  MEETING_DETAIL_BOTTOM_BAR_HORIZONTAL_PADDING,
  resolveBottomBarAvailableWidth,
  type MeetingDetailBottomAction,
} from '@/src/lib/meeting-detail-bottom-bar';
import { useMemo } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

export type MeetingDetailBottomBarRowProps = {
  actions: readonly MeetingDetailBottomAction[];
  rowWidth: number;
  fallbackWidth: number;
  compactTypography?: boolean;
  onRowLayout?: (width: number) => void;
};

export function MeetingDetailBottomBarRow({
  actions,
  rowWidth,
  fallbackWidth,
  compactTypography = false,
  onRowLayout,
}: MeetingDetailBottomBarRowProps) {
  const pillLayouts = useMemo(() => {
    const available = resolveBottomBarAvailableWidth(rowWidth, fallbackWidth, actions.length);
    return computeBottomBarPillLayouts(actions, available, { compactTypography });
  }, [actions, rowWidth, fallbackWidth, compactTypography]);

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0) onRowLayout?.(w);
  };

  if (actions.length === 0) return null;

  return (
    <View style={meetingDetailBottomPillStyles.bottomBarEqualRow} onLayout={handleLayout}>
      {actions.map((action, index) => {
        const layout = pillLayouts[index];
        if (!layout) return null;
        return (
          <MeetingDetailBottomPill
            key={action.id}
            action={action}
            mode={layout.mode}
            flexGrow={layout.flexGrow}
            minWidth={layout.minWidth}
            compactTypography={compactTypography}
          />
        );
      })}
    </View>
  );
}

export function meetingDetailBottomBarFallbackWidth(windowWidth: number): number {
  return Math.max(0, windowWidth - MEETING_DETAIL_BOTTOM_BAR_HORIZONTAL_PADDING);
}
