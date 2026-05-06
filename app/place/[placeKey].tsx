import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PlaceTemperatureHeaderCard } from '@/components/place/PlaceTemperatureHeaderCard';
import { GinitTheme } from '@/constants/ginit-theme';

function pickParam(v: string | string[] | undefined): string {
  if (v == null) return '';
  return Array.isArray(v) ? (v[0] ?? '').trim() : String(v).trim();
}

export default function PlaceDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ placeKey?: string | string[]; placeName?: string | string[] }>();
  const rawKey = pickParam(params.placeKey);
  const placeKey = useMemo(() => {
    try {
      return decodeURIComponent(rawKey).trim();
    } catch {
      return rawKey.trim();
    }
  }, [rawKey]);
  const placeName = pickParam(params.placeName);

  const onBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.topRow}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button">
          <Text style={styles.back}>← 닫기</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {placeName ? <Text style={styles.title}>{placeName}</Text> : null}
        <PlaceTemperatureHeaderCard placeKey={placeKey || null} />
        <Text style={styles.hint}>장소 상세·지도 등은 추후 연동됩니다.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  topRow: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  back: {
    fontSize: 16,
    fontWeight: '600',
    color: GinitTheme.colors.primary,
  },
  body: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: GinitTheme.colors.text,
    marginBottom: 12,
  },
  hint: {
    marginTop: 16,
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
  },
});
