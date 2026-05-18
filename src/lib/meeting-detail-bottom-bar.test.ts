import { describe, expect, it } from 'vitest';

import {
  computeBottomBarLabelMode,
  computeBottomBarPillLayouts,
  computeBottomBarPillModes,
  estimatePillMinWidthForMode,
  meetingArrivalBottomLabels,
  type MeetingDetailBottomAction,
} from './meeting-detail-bottom-bar';

function action(partial: Partial<MeetingDetailBottomAction> & Pick<MeetingDetailBottomAction, 'id'>): MeetingDetailBottomAction {
  return {
    icon: 'wallet-outline',
    labelFull: partial.labelFull ?? '정산',
    labelCompact: partial.labelCompact ?? '정산',
    a11yLabel: partial.a11yLabel ?? '정산',
    variant: 'purple',
    ...partial,
  };
}

describe('meeting-detail-bottom-bar', () => {
  it('arrival labels expand in full mode', () => {
    expect(meetingArrivalBottomLabels({ verified: false, withinWindow: true }).labelFull).toBe('도착 인증');
    expect(meetingArrivalBottomLabels({ verified: false, withinWindow: true }).labelCompact).toBe('인증');
  });

  it('degrades left pills first and keeps rightmost labels longer', () => {
    const actions: MeetingDetailBottomAction[] = [
      action({ id: 'share', labelFull: '공유', labelCompact: '공유', icon: 'share-outline', variant: 'blue' }),
      action({ id: 'chat', labelFull: '채팅', labelCompact: '채팅', icon: 'chatbubbles-outline', variant: 'blue' }),
      action({ id: 'settle', labelFull: '정산', labelCompact: '정산', icon: 'wallet-outline' }),
    ];
    const available = 200;
    const modes = computeBottomBarPillModes(actions, available, { compactTypography: false });
    expect(modes[0]).not.toBe('full');
    expect(modes[2]).toBe('full');
  });

  it('splits icon-only row width evenly when min widths overflow', () => {
    const actions: MeetingDetailBottomAction[] = [
      action({ id: 'share', labelFull: '공유', labelCompact: '공유', icon: 'share-outline', variant: 'blue' }),
      action({ id: 'chat', labelFull: '채팅', labelCompact: '채팅', icon: 'chatbubbles-outline', variant: 'blue' }),
      action({ id: 'delete', labelFull: '삭제', labelCompact: '삭제', icon: 'trash-outline', variant: 'danger' }),
      action({
        id: 'confirm',
        labelFull: '확정 취소',
        labelCompact: '확정 취소',
        icon: 'close-circle-outline',
        variant: 'danger',
      }),
      action({ id: 'arrival', labelFull: '도착 인증', labelCompact: '인증', icon: 'location-outline' }),
      action({ id: 'settle', labelFull: '정산', labelCompact: '정산', icon: 'wallet-outline' }),
    ];
    const available = 200;
    const layouts = computeBottomBarPillLayouts(actions, available, { compactTypography: false });
    expect(layouts.every((l) => l.mode === 'iconOnly')).toBe(true);
    expect(layouts.reduce((s, l) => s + l.minWidth, 0)).toBeLessThanOrEqual(available + 1);
    expect(layouts.every((l) => l.flexGrow === 1)).toBe(true);
  });

  it('boosts rightmost flex only when label modes are mixed', () => {
    const actions: MeetingDetailBottomAction[] = [
      action({ id: 'share', labelFull: '공유', labelCompact: '공유', icon: 'share-outline', variant: 'blue' }),
      action({ id: 'chat', labelFull: '채팅', labelCompact: '채팅', icon: 'chatbubbles-outline', variant: 'blue' }),
      action({ id: 'settle', labelFull: '정산', labelCompact: '정산', icon: 'wallet-outline' }),
    ];
    const layouts = computeBottomBarPillLayouts(actions, 200, { compactTypography: false });
    expect(layouts[0]?.mode).not.toBe(layouts[2]?.mode);
    expect(layouts[0]?.flexGrow).toBe(1);
    expect(layouts[2]?.flexGrow).toBe(2);
  });

  it('prefers full mode on wide rows', () => {
    const actions: MeetingDetailBottomAction[] = [
      action({ id: 'chat', labelFull: '채팅', labelCompact: '채팅', icon: 'chatbubbles-outline', variant: 'blue' }),
      action({ id: 'leave', labelFull: '나가기', labelCompact: '나가기', icon: 'exit-outline', variant: 'danger' }),
    ];
    const width =
      estimatePillMinWidthForMode(actions[0]!, 'full', { compactTypography: false }) +
      estimatePillMinWidthForMode(actions[1]!, 'full', { compactTypography: false });
    expect(computeBottomBarLabelMode(actions, width, { compactTypography: false })).toBe('full');
  });
});
