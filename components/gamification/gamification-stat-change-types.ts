export type GamificationStatKind = 'xp' | 'trust';

export type GamificationStatRow = {
  kind: GamificationStatKind;
  /** 양수=상승, 음수=하락 (표시·애니메이션은 절대값 기준) */
  delta: number;
};

export type GamificationStatChangeTone = 'reward' | 'penalty' | 'neutral';

export type GamificationStatChangeMode = 'result' | 'confirm';

export type GamificationStatChangeButton = {
  label: string;
  variant?: 'primary' | 'destructive' | 'secondary';
  onPress?: () => void;
};

export type GamificationStatChangePayload = {
  mode: GamificationStatChangeMode;
  tone: GamificationStatChangeTone;
  title: string;
  body?: string;
  rows: GamificationStatRow[];
  footnote?: string;
  penaltyCountNote?: string;
  primaryButton: GamificationStatChangeButton;
  secondaryButton?: GamificationStatChangeButton;
  /** confirm: false, result 보상·패널티: true */
  animateNumbers?: boolean;
};
