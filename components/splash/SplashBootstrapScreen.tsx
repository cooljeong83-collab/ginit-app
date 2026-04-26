import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SPLASH_LOGO_FRAME_PX, SPLASH_LOGO_IMAGE_PX } from '@/constants/login-logo-intro';
import { GinitTheme } from '@/constants/ginit-theme';
import { useSplashBootstrap } from '@/src/hooks/useSplashBootstrap';

const WIN_H = Dimensions.get('window').height;

/**
 * Android: 시스템 스플래시와 동일 — 배경 `#FFFFFF`, 그림은 `icon.png`(Expo 앱 아이콘과 동일).
 * iOS·웹: 기존 다크/라이트 배경 + `logo-symbol` 카드.
 * SafeArea로 로고를 밀지 않고, 하단 푸터만 인셋을 반영합니다.
 */
export default function SplashBootstrapScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const insets = useSafeAreaInsets();
  const androidPlainSplash = Platform.OS === 'android';
  const bg = androidPlainSplash ? '#FFFFFF' : isDark ? '#0F172A' : '#FFFFFF';
  const logoCardBg = isDark ? 'rgba(248, 250, 252, 0.10)' : 'rgba(255, 255, 255, 0.96)';
  const logoBorder = isDark ? 'rgba(248, 250, 252, 0.14)' : 'rgba(15, 23, 42, 0.08)';
  const lightChrome = androidPlainSplash || !isDark;
  const statusColor = lightChrome ? GinitTheme.colors.textSub : 'rgba(226, 232, 240, 0.88)';
  const hintColor = lightChrome ? GinitTheme.colors.textMuted : 'rgba(148, 163, 184, 0.95)';
  const ruleColor = lightChrome ? 'rgba(15, 23, 42, 0.12)' : 'rgba(248, 250, 252, 0.16)';
  const copyColor = lightChrome ? GinitTheme.colors.textMuted : 'rgba(148, 163, 184, 0.9)';

  const metaTop = useMemo(() => WIN_H / 2 + SPLASH_LOGO_FRAME_PX / 2 + 18, []);

  const { readyForUi, statusLabel, hintMessage } = useSplashBootstrap();
  const didHideSplash = useRef(false);

  /**
   * `preventAutoHideAsync()`가 걸린 상태에서, expo-splash-screen의 PreDrawListener가
   * 첫 프레임 그리기를 취소할 수 있습니다. `onLayout`만 기다리면 hideAsync가 호출되지 않아
   * 시작 스플래시에 갇히는 데드락이 생길 수 있어, 마운트 후 즉시 hideAsync를 시도합니다.
   */
  useEffect(() => {
    if (didHideSplash.current) return;
    didHideSplash.current = true;
    requestAnimationFrame(() => {
      void SplashScreen.hideAsync().catch(() => {});
    });
  }, []);

  const onRootLayout = useCallback(() => {
    if (didHideSplash.current) return;
    didHideSplash.current = true;
    requestAnimationFrame(() => {
      void SplashScreen.hideAsync().catch(() => {});
    });
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: bg }]} onLayout={onRootLayout}>
      <StatusBar style="dark" translucent backgroundColor="transparent" />

      <View style={styles.logoLayer} pointerEvents="none">
        {androidPlainSplash ? (
          <Image
            source={require('@/assets/images/icon.png')}
            style={styles.logoImgAndroid}
            contentFit="contain"
          />
        ) : (
          <View style={[styles.logoMark, { backgroundColor: logoCardBg, borderColor: logoBorder }]}>
            <Image source={require('@/assets/images/logo_symbol.png')} style={styles.logoImg} contentFit="contain" />
          </View>
        )}
      </View>

      <View style={[styles.metaLayer, { top: metaTop }]}>
        <ActivityIndicator
          size="large"
          color={lightChrome ? GinitTheme.colors.primary : '#E2E8F0'}
          style={styles.spinner}
        />
        <Text style={[styles.status, { color: statusColor }]}>
          {readyForUi ? statusLabel : '불러오는 중…'}
        </Text>
        {hintMessage ? <Text style={[styles.hint, { color: hintColor }]}>{hintMessage}</Text> : null}
      </View>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 10 }]}>
        <Text style={[styles.slogan, { color: lightChrome ? GinitTheme.colors.primary : '#F8FAFC' }]}>
          모임의 시작, 지닛(Ginit)
        </Text>
        <View style={[styles.rule, { backgroundColor: ruleColor }]} />
        <Text style={[styles.copy, { color: copyColor }]}>Copyright © 2026 Ginit. All rights reserved.</Text>
        {Platform.OS !== 'web' ? (
          <Text style={[styles.legalMuted, { color: hintColor }]}>기기·서버 상태를 확인하는 동안 표시됩니다.</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  /** 시스템 스플래시와 동일: 전체 창 기준 정중앙(상태바 영역 포함, 패딩 없음) */
  logoLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoMark: {
    width: SPLASH_LOGO_FRAME_PX,
    height: SPLASH_LOGO_FRAME_PX,
    borderRadius: Math.round(SPLASH_LOGO_FRAME_PX * 0.295),
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: GinitTheme.shadow.card.shadowColor,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.85,
    shadowRadius: 20,
    elevation: 8,
  },
  logoImg: {
    width: SPLASH_LOGO_IMAGE_PX,
    height: SPLASH_LOGO_IMAGE_PX,
  },
  /** Adaptive `ic_launcher_foreground`와 동일 비트맵 — 시스템 스플래시와 1:1 느낌 */
  logoImgAndroid: {
    width: SPLASH_LOGO_FRAME_PX,
    height: SPLASH_LOGO_FRAME_PX,
  },
  metaLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: GinitTheme.spacing.xl,
  },
  spinner: {
    transform: [{ scale: 1.05 }],
  },
  status: {
    marginTop: 14,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  hint: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 320,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: GinitTheme.spacing.xl,
    alignItems: 'center',
    gap: 10,
  },
  slogan: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    width: '72%',
    maxWidth: 280,
  },
  copy: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  legalMuted: {
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 2,
  },
});
