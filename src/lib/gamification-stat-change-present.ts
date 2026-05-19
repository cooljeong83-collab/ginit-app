import type { GamificationStatRow } from '@/components/gamification/gamification-stat-change-types';
import { showGamificationStatChange } from '@/components/gamification/gamification-stat-change-api';

function buildRewardRows(xp: number, trust: number): GamificationStatRow[] {
  const rows: GamificationStatRow[] = [];
  const t = Math.trunc(trust);
  const x = Math.trunc(xp);
  if (t > 0) rows.push({ kind: 'trust', delta: t });
  if (x > 0) rows.push({ kind: 'xp', delta: x });
  return rows;
}

function buildPenaltyRows(trustDrop: number, xpDrop: number): GamificationStatRow[] {
  const rows: GamificationStatRow[] = [];
  const t = Math.abs(Math.trunc(trustDrop));
  const x = Math.abs(Math.trunc(xpDrop));
  if (t > 0) rows.push({ kind: 'trust', delta: -t });
  if (x > 0) rows.push({ kind: 'xp', delta: -x });
  return rows;
}

/** XP·신뢰 보상 반영 후 — 카운트업 애니메이션 */
export function presentGamificationReward(opts: {
  title: string;
  body?: string;
  xp: number;
  trust: number;
  footnote?: string;
  primaryLabel?: string;
  onPrimary?: () => void;
}): void {
  showGamificationStatChange({
    mode: 'result',
    tone: 'reward',
    title: opts.title,
    body: opts.body,
    rows: buildRewardRows(opts.xp, opts.trust),
    footnote: opts.footnote,
    animateNumbers: true,
    primaryButton: {
      label: opts.primaryLabel ?? '확인',
      variant: 'primary',
      onPress: opts.onPrimary,
    },
  });
}

/** XP·신뢰 패널티 반영 후 — 카운트업 애니메이션 */
export function presentGamificationPenaltyResult(opts: {
  title?: string;
  body?: string;
  trustDrop: number;
  xpDrop: number;
  penaltyNote?: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  profileLabel?: string;
  onGoProfile?: () => void;
}): void {
  const hasProfile = typeof opts.onGoProfile === 'function';
  showGamificationStatChange({
    mode: 'result',
    tone: 'penalty',
    title: opts.title ?? '신뢰 패널티가 반영됐어요',
    body: opts.body,
    rows: buildPenaltyRows(opts.trustDrop, opts.xpDrop),
    penaltyCountNote: opts.penaltyNote ?? '누적 패널티가 1회 늘었어요.',
    animateNumbers: true,
    primaryButton: {
      label: opts.primaryLabel ?? (hasProfile ? (opts.profileLabel ?? '프로필로') : '확인'),
      variant: 'primary',
      onPress: hasProfile ? opts.onGoProfile : opts.onPrimary,
    },
    secondaryButton: hasProfile
      ? {
          label: '닫기',
          variant: 'secondary',
          onPress: opts.onPrimary,
        }
      : undefined,
  });
}
