/** React 외 광고 서비스(App Open·전면)용 — `AdsVisibilityHost`가 동기화 */
let shouldShowAds = true;

export function getShouldShowAds(): boolean {
  return shouldShowAds;
}

export function setShouldShowAds(enabled: boolean): void {
  shouldShowAds = enabled;
}
