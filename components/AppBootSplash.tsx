import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';

/**
 * Android 12+ 기본 스플래시는 아이콘 + 배경만 지원해서,
 * 첨부 레퍼런스 같은 “포스터형 로딩 화면”은 앱 첫 화면에서 오버레이로 보여줍니다.
 *
 * 네이티브 스플래시가 사라진 직후 잠깐만 보여 주는 용도입니다.
 */
export function AppBootSplash() {
  const scheme = useColorScheme();
  const [visible, setVisible] = useState(true);

  const source = useMemo(() => {
    return scheme === 'dark'
      ? require('@/assets/images/splash-dark.png')
      : require('@/assets/images/splash.png');
  }, [scheme]);

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 900);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <View pointerEvents="none" style={styles.root} accessibilityLabel="앱 로딩 화면">
      <Image source={source} style={styles.bg} contentFit="cover" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
  },
  bg: {
    width: '100%',
    height: '100%',
  },
});

