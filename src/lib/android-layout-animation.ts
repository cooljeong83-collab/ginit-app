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
