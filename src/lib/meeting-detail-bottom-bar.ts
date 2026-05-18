import type { SymbolicIconName } from '@/components/ui/GinitSymbolicIcon';

export type MeetingDetailBottomLabelMode = 'full' | 'compact' | 'iconOnly';

export type MeetingDetailBottomPillVariant = 'blue' | 'orange' | 'danger' | 'purple';

export type MeetingDetailBottomAction = {
  id: string;
  icon: SymbolicIconName;
  labelFull: string;
  labelCompact: string;
  a11yLabel: string;
  variant: MeetingDetailBottomPillVariant;
  disabled?: boolean;
  busy?: boolean;
  onPress?: () => void;
  /** 확정(오렌지) pill 등 라벨 색 분기 */
  labelOnOrange?: boolean;
  iconColor?: string;
  /** 비활성·저장 대기 등 고정 opacity */
  mutedOpacity?: number;
};

export const MEETING_DETAIL_BOTTOM_BAR_ROW_GAP = 10;
export const MEETING_DETAIL_BOTTOM_BAR_HORIZONTAL_PADDING = 24;
export const MEETING_DETAIL_BOTTOM_ICON_PILL_WIDTH = 50;
/** `TransientBottomMessage`가 모임 상세 하단 CTA 위에 뜨도록 하는 추가 bottom 오프셋(px, safe area 제외) */
export const MEETING_DETAIL_TRANSIENT_BOTTOM_OFFSET_PX = 74;
const PILL_INNER_GAP = 3;
const PILL_LABELED_PADDING_H = 12;

export function meetingArrivalBottomLabels(opts: {
  verified: boolean;
  withinWindow: boolean;
}): { labelFull: string; labelCompact: string; a11yLabel: string } {
  if (opts.verified) {
    return {
      labelFull: '도착 인증 완료',
      labelCompact: '인증 완료',
      a11yLabel: '도착 인증 완료',
    };
  }
  if (opts.withinWindow) {
    return {
      labelFull: '도착 인증',
      labelCompact: '인증',
      a11yLabel: '인증하기',
    };
  }
  return {
    labelFull: '시간 외',
    labelCompact: '시간 외',
    a11yLabel: '도착 인증 시간 외',
  };
}

export function estimateTextWidthPx(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) {
    units += ch.charCodeAt(0) > 0xff ? 1 : 0.55;
  }
  return Math.ceil(units * fontSize * 0.92);
}

export function resolveBottomBarAvailableWidth(
  rowWidth: number,
  fallbackWidth: number,
  buttonCount: number,
): number {
  const base = rowWidth > 0 ? rowWidth : fallbackWidth;
  if (buttonCount <= 0) return base;
  const gapTotal = Math.max(0, buttonCount - 1) * MEETING_DETAIL_BOTTOM_BAR_ROW_GAP;
  return Math.max(0, base - gapTotal);
}

function estimateLabeledPillMinWidth(
  label: string,
  iconSize: number,
  fontSize: number,
): number {
  const textW = estimateTextWidthPx(label, fontSize);
  return iconSize + PILL_INNER_GAP + PILL_LABELED_PADDING_H * 2 + textW;
}

export function estimatePillMinWidthForMode(
  action: MeetingDetailBottomAction,
  mode: MeetingDetailBottomLabelMode,
  opts: { compactTypography: boolean },
): number {
  if (mode === 'iconOnly') {
    return MEETING_DETAIL_BOTTOM_ICON_PILL_WIDTH;
  }
  const iconSize = opts.compactTypography ? 16 : 18;
  const fontSize = opts.compactTypography ? 12 : 14;
  const label = mode === 'full' ? action.labelFull : action.labelCompact;
  return Math.max(MEETING_DETAIL_BOTTOM_ICON_PILL_WIDTH, estimateLabeledPillMinWidth(label, iconSize, fontSize));
}

export function sumPillWidthsForMode(
  actions: readonly MeetingDetailBottomAction[],
  mode: MeetingDetailBottomLabelMode,
  opts: { compactTypography: boolean },
): number {
  return actions.reduce((sum, a) => sum + estimatePillMinWidthForMode(a, mode, opts), 0);
}

export function computeBottomBarLabelMode(
  actions: readonly MeetingDetailBottomAction[],
  availableWidth: number,
  opts: { compactTypography: boolean },
): MeetingDetailBottomLabelMode {
  const modes = computeBottomBarPillModes(actions, availableWidth, opts);
  if (modes.length === 0) return 'full';
  const first = modes[0]!;
  return modes.every((m) => m === first) ? first : 'compact';
}

/** 좌측부터 라벨을 줄이고 우측(마지막) 버튼이 라벨·크기 우선순위를 갖도록 한다. */
export function computeBottomBarPillModes(
  actions: readonly MeetingDetailBottomAction[],
  availableWidth: number,
  opts: { compactTypography: boolean },
): MeetingDetailBottomLabelMode[] {
  const n = actions.length;
  if (n === 0) return [];

  const modes: MeetingDetailBottomLabelMode[] = Array.from({ length: n }, () => 'full');
  const totalWidth = (ms: readonly MeetingDetailBottomLabelMode[]) =>
    ms.reduce((sum, mode, i) => sum + estimatePillMinWidthForMode(actions[i]!, mode, opts), 0);

  if (totalWidth(modes) <= availableWidth) return modes;

  for (let i = 0; i < n - 1; i++) modes[i] = 'iconOnly';

  for (let i = n - 2; i >= 0; i--) {
    modes[i] = 'compact';
    if (totalWidth(modes) > availableWidth) {
      modes[i] = 'iconOnly';
      continue;
    }
    modes[i] = 'full';
    if (totalWidth(modes) > availableWidth) modes[i] = 'compact';
  }

  if (totalWidth(modes) <= availableWidth) return modes;

  modes[n - 1] = 'compact';
  if (totalWidth(modes) <= availableWidth) return modes;
  modes[n - 1] = 'iconOnly';
  return modes;
}

/** 라벨 모드가 버튼마다 다를 때만 분배가 애매한 것으로 본다. */
export function isAmbiguousBottomBarSplit(modes: readonly MeetingDetailBottomLabelMode[]): boolean {
  if (modes.length <= 1) return false;
  const first = modes[0]!;
  return !modes.every((mode) => mode === first);
}

/** 기본 균등(1). 분할이 애매할 때만 우측(마지막) 버튼을 더 넓힌다. */
export function computeBottomBarPillFlexGrow(
  index: number,
  count: number,
  ambiguous: boolean,
): number {
  if (!ambiguous) return 1;
  if (index === count - 1) return 2;
  return 1;
}

export type MeetingDetailBottomPillLayout = {
  mode: MeetingDetailBottomLabelMode;
  flexGrow: number;
  minWidth: number;
};

export function computeBottomBarPillLayouts(
  actions: readonly MeetingDetailBottomAction[],
  availableWidth: number,
  opts: { compactTypography: boolean },
): MeetingDetailBottomPillLayout[] {
  const n = actions.length;
  if (n === 0) return [];

  const modes = computeBottomBarPillModes(actions, availableWidth, opts);
  const minWidths = modes.map((mode, index) =>
    estimatePillMinWidthForMode(actions[index]!, mode, opts),
  );
  const minSum = minWidths.reduce((s, w) => s + w, 0);
  const equalMinWidth = Math.max(1, Math.floor(availableWidth / n));

  const ambiguous = isAmbiguousBottomBarSplit(modes);

  return modes.map((mode, index) => ({
    mode,
    flexGrow: computeBottomBarPillFlexGrow(index, n, ambiguous),
    minWidth: minSum > availableWidth ? equalMinWidth : minWidths[index]!,
  }));
}

export function resolveBottomBarDisplayLabel(
  action: MeetingDetailBottomAction,
  mode: MeetingDetailBottomLabelMode,
): string {
  if (mode === 'iconOnly') return '';
  return mode === 'full' ? action.labelFull : action.labelCompact;
}
