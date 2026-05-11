import { Image } from 'expo-image';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import { settlementBankFaviconUrl } from '@/src/lib/korean-banks-settlement';

function glyphTextColorForBrandHex(hex: string): string {
  const s = hex.replace('#', '').trim();
  if (s.length !== 6) return '#fff';
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  if (![r, g, b].every((x) => Number.isFinite(x))) return '#fff';
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? GinitTheme.colors.text : '#fff';
}

type Props = {
  faviconDomain: string;
  /** 로드 실패 시 원 안 글리프 */
  fallbackLetter: string;
  brandColor: string;
  size?: number;
};

export function SettlementBankLogo({ faviconDomain, fallbackLetter, brandColor, size = 28 }: Props) {
  const [failed, setFailed] = useState(false);
  const uri = faviconDomain.trim() ? settlementBankFaviconUrl(faviconDomain.trim()) : '';
  const letter = (fallbackLetter.trim().slice(0, 1) || '?').toUpperCase();
  const onError = useCallback(() => setFailed(true), []);

  if (failed || !uri) {
    const s = size;
    return (
      <View
        style={[
          styles.glyphShell,
          { width: s, height: s, borderRadius: s / 2, backgroundColor: brandColor || GinitTheme.colors.primary },
        ]}>
        <Text
          style={[
            styles.glyphText,
            { fontSize: Math.max(11, s * 0.38), color: glyphTextColorForBrandHex(brandColor || '#334155') },
          ]}>
          {letter}
        </Text>
      </View>
    );
  }

  return (
    <Image
      accessibilityIgnoresInvertColors
      source={{ uri }}
      style={{ width: size, height: size, borderRadius: size * 0.22 }}
      contentFit="contain"
      onError={onError}
    />
  );
}

const styles = StyleSheet.create({
  glyphShell: { alignItems: 'center', justifyContent: 'center' },
  glyphText: { fontWeight: '800' },
});
