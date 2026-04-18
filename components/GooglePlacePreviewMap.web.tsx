import { StyleSheet, Text, View } from 'react-native';

type Props = {
  latitude: number;
  longitude: number;
  height?: number;
  borderRadius?: number;
};

/**
 * 웹 번들에는 `react-native-maps`를 넣지 않습니다(네이티브 전용 codegen).
 * 미리보기는 iOS·Android에서만 제공합니다.
 */
export function GooglePlacePreviewMap({ height = 180, borderRadius = 15 }: Props) {
  return (
    <View
      style={[styles.box, { height, borderRadius }, styles.fallbackCenter]}
      accessibilityLabel="지도 미리보기">
      <Text style={styles.fallbackText}>지도 미리보기는 iOS·Android 앱에서 제공됩니다.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: '100%',
    overflow: 'hidden',
    flexShrink: 0,
    backgroundColor: 'rgba(226, 232, 240, 0.85)',
  },
  fallbackCenter: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 },
  fallbackText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
    textAlign: 'center',
  },
});
