import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * 네이티브 스플래시가 사라진 직후 잠깐 보이는 오버레이.
 * 이미지는 Expo 앱 아이콘(`icon.png`)과 동일합니다.
 */
export function AppBootSplash() {
  const [visible, setVisible] = useState(true);

  const source = useMemo(() => require('@/assets/images/icon.png'), []);

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

