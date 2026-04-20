import { StyleSheet, Text, View } from 'react-native';

/**
 * 웹 번들에서는 `MapScreen.tsx`(네이버 네이티브 지도)를 포함하지 않습니다.
 * 해당 패키지는 `codegenNativeComponent` 등 웹 미지원 API에 의존합니다.
 */
export default function MapScreen() {
  return (
    <View style={styles.webRoot}>
      <View style={styles.webOuter}>
        <View style={styles.webBox}>
          <Text style={styles.webText}>지도 보기는 모바일 앱에서만 제공됩니다.</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  webRoot: {
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
