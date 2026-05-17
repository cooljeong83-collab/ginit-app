import { GinitPressable } from '@/components/ui/GinitPressable';
import { StyleSheet, Text, View } from 'react-native';

import type { FeedInterestRegionControls } from '@/src/hooks/use-feed-interest-region-controls';

export type InterestRegionHeaderClusterProps = {
  controls: Pick<
    FeedInterestRegionControls,
    | 'feedLocationReady'
    | 'registeredRegions'
    | 'exploreActiveRegionNorm'
    | 'displayRegionLabel'
    | 'openRegionModal'
    | 'getInterestRegionDisplayLabel'
  >;
  variant?: 'feed' | 'mapGlass';
};

export function InterestRegionHeaderCluster({
  controls,
  variant = 'feed',
}: InterestRegionHeaderClusterProps) {
  const {
    feedLocationReady,
    registeredRegions,
    exploreActiveRegionNorm,
    displayRegionLabel,
    openRegionModal,
    getInterestRegionDisplayLabel,
  } = controls;

  const isMapGlass = variant === 'mapGlass';

  return (
    <View
      style={[
        styles.locationCluster,
        isMapGlass && styles.locationClusterMap,
        isMapGlass && styles.locationClusterMapChip,
      ]}>
      <GinitPressable
        onPress={openRegionModal}
        style={({ pressed }) => [
          styles.locationClusterPressable,
          isMapGlass && styles.locationClusterPressableMap,
          pressed && !isMapGlass && styles.locationClusterPressed,
          pressed && isMapGlass && styles.locationClusterMapPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="관심 지역 등록·편집"
        hitSlop={8}>
        <Text
          style={[styles.locationText, isMapGlass && styles.locationTextMap]}
          numberOfLines={1}
          accessibilityLabel={
            feedLocationReady
              ? registeredRegions.length === 0
                ? '관심 지역 등록'
                : `표시 중인 지역 ${getInterestRegionDisplayLabel(exploreActiveRegionNorm)}`
              : '관심 지역, 불러오는 중'
          }>
          {displayRegionLabel}
        </Text>
      </GinitPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  locationCluster: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    minWidth: 0,
  },
  locationClusterMap: {
    flex: 1,
  },
  /** MapScreen `topChip` — 설정 아이콘 칩과 동일 */
  locationClusterMapChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.34)',
  },
  locationClusterPressable: {
    alignSelf: 'flex-start',
    flexShrink: 1,
    minWidth: 0,
    maxWidth: 220,
    borderRadius: 10,
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  locationClusterPressableMap: {
    maxWidth: undefined,
    flex: 1,
    paddingVertical: 0,
    paddingHorizontal: 4,
  },
  locationClusterPressed: {
    backgroundColor: 'rgba(15, 23, 42, 0.05)',
  },
  locationClusterMapPressed: {
    opacity: 0.88,
  },
  locationText: {
    flexShrink: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
    minWidth: 0,
  },
  locationTextMap: {
    fontSize: 17,
    color: '#0f172a',
  },
});
