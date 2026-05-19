import type { GamificationStatChangePayload } from '@/components/gamification/gamification-stat-change-types';

type ShowFn = (payload: GamificationStatChangePayload) => void;
type DismissFn = () => void;

let showImpl: ShowFn | undefined;
let dismissImpl: DismissFn | undefined;

export function registerGamificationStatChangeHandlers(show: ShowFn, dismiss: DismissFn): void {
  showImpl = show;
  dismissImpl = dismiss;
}

export function unregisterGamificationStatChangeHandlers(): void {
  showImpl = undefined;
  dismissImpl = undefined;
}

export function showGamificationStatChange(payload: GamificationStatChangePayload): void {
  showImpl?.(payload);
}

export function dismissGamificationStatChange(): void {
  dismissImpl?.();
}
