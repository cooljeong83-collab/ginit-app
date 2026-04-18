import { Platform, StyleSheet, Text, View } from 'react-native';

/**
 * 네이버 지도 전체 화면. 웹에서는 네이티브 SDK를 로드하지 않습니다.
 */
export default function MapScreen() {
  if (Platform.OS === 'web') {
    return (
      <View style={styles.root}>
        <View style={styles.webOuter}>
          <View style={styles.webBox}>
            <Text style={styles.webText}>지도는 모바일 앱에서만 확인 가능합니다</Text>
          </View>
        </View>
      </View>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports -- 웹 번들에서 네이티브 지도 SDK 제외
  const { NaverMapView } = require('@mj-studio/react-native-naver-map') as typeof import('@mj-studio/react-native-naver-map');

  return (
    <View style={styles.root}>
      <NaverMapView
        style={StyleSheet.absoluteFillObject}
        initialCamera={{
          latitude: 37.5665,
          longitude: 126.978,
          zoom: 12,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  webOuter: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  webBox: {
    paddingVertical: 28,
    paddingHorizontal: 22,
    borderRadius: 18,
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    maxWidth: 440,
    width: '100%',
    alignSelf: 'center',
  },
  webText: {
    color: '#f1f5f9',
    fontSize: 17,
    lineHeight: 26,
    textAlign: 'center',
    fontWeight: '600',
  },
});
