import { DeviceEventEmitter } from 'react-native';

/** 모임·지도 탭 등 `useFeedInterestRegionControls` 인스턴스 간 선택 동기화 */
export const FEED_INTEREST_REGION_SELECTION_CHANGED = 'ginit:feed-interest-region-selection-changed';

export function emitFeedInterestRegionSelectionChanged(): void {
  DeviceEventEmitter.emit(FEED_INTEREST_REGION_SELECTION_CHANGED);
}
