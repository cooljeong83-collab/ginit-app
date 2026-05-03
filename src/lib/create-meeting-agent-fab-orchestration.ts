/**
 * 모임 생성 `details` ↔ `CreateMeetingAgenticAiFab` 오케스트레이션.
 * Provider 밖에서 정의된 `applyWizardSuggestion`이 FAB 상승·탭 연출과 동기화할 때 사용합니다.
 */

type VoidFn = () => void;

/** `user`: 직접 입력·대기(부드러운 idle). `auto`: 수락 후 자동 진행(너지·수락 연출) 구간. */
export type AgentFabMotionMode = 'user' | 'auto';

let step1InteractionUnlocked = false;
const step1Listeners = new Set<VoidFn>();

let fabMotionMode: AgentFabMotionMode = 'user';
const fabMotionListeners = new Set<VoidFn>();

let fabMicroNudgeImpl: (() => void) | null = null;

export function setAgentStep1InteractionUnlocked(v: boolean): void {
  step1InteractionUnlocked = v;
  step1Listeners.forEach((l) => l());
}

export function getAgentStep1InteractionUnlocked(): boolean {
  return step1InteractionUnlocked;
}

export function subscribeAgentStep1InteractionUnlocked(cb: VoidFn): () => void {
  step1Listeners.add(cb);
  return () => {
    step1Listeners.delete(cb);
  };
}

export function setAgentFabMotionMode(next: AgentFabMotionMode): void {
  if (fabMotionMode === next) return;
  fabMotionMode = next;
  fabMotionListeners.forEach((l) => l());
}

export function getAgentFabMotionMode(): AgentFabMotionMode {
  return fabMotionMode;
}

export function subscribeAgentFabMotionMode(cb: VoidFn): () => void {
  fabMotionListeners.add(cb);
  return () => {
    fabMotionListeners.delete(cb);
  };
}

export function registerFabMicroNudge(fn: (() => void) | null): void {
  fabMicroNudgeImpl = fn;
}

export function playFabMicroNudge(): void {
  fabMicroNudgeImpl?.();
}
