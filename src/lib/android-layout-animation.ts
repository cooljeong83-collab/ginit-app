import { LayoutAnimation, Platform, UIManager } from 'react-native';

let legacyExperimentalEnabled = false;

function isFabricRuntime(): boolean {
  return Boolean((globalThis as { nativeFabricUIManager?: unknown }).nativeFabricUIManager);
}

/**
 * Android에서 `LayoutAnimation`이 legacy bridge에서 동작하도록 experimental 플래그를 켭니다.
 * New Architecture(Fabric)에서는 해당 API가 no-op이며 호출 시 경고만 출력되므로 호출하지 않습니다.
 */
export function ensureAndroidLayoutAnimationExperimental(): void {
  if (Platform.OS !== 'android') return;
  if (isFabricRuntime()) return;
  if (legacyExperimentalEnabled) return;
  legacyExperimentalEnabled = true;
  if (typeof UIManager.setLayoutAnimationEnabledExperimental === 'function') {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }
}

export function layoutAnimateEaseInEaseOut(): void {
  ensureAndroidLayoutAnimationExperimental();
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}

/**
 * 모임 생성 마법사 등 단계 카드 전용 — Preset보다 긴 duration으로 펼침·스크롤 전환이 덜 딱딱하게 느껴지도록.
 * (Fabric에서는 LayoutAnimation이 no-op일 수 있음 — 기존과 동일)
 */
export function layoutAnimateMeetingCreateWizard(): void {
  ensureAndroidLayoutAnimationExperimental();
  LayoutAnimation.configureNext({
    duration: 400,
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  });
}
