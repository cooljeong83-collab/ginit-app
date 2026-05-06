import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import { fetchPlaceRatingSummary } from '@/src/lib/place-rating-supabase';

type Props = {
  placeKey: string | null;
  onPress?: (() => void) | undefined;
};

export function PlaceTemperatureHeaderCard({ placeKey, onPress }: Props) {
  const [avg, setAvg] = useState(0);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    const k = placeKey?.trim() ?? '';
    if (!k) {
      setAvg(0);
      setTotal(0);
      return;
    }
    const r = await fetchPlaceRatingSummary(k);
    if (r.ok) {
      setAvg(r.summary.averageRating);
      setTotal(r.summary.totalReviews);
    }
  }, [placeKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const line = `지닛 멤버들이 평가한 이 장소의 온도: ${avg.toFixed(1)}/5.0`;
  const sub = total > 0 ? `리뷰 ${total}건` : null;

  const inner = (
    <View style={styles.panel}>
      <Text style={styles.mainText}>{line}</Text>
      {sub ? <Text style={styles.subText}>{sub}</Text> : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" style={styles.wrap}>
        {inner}
      </Pressable>
    );
  }
  return <View style={styles.wrap}>{inner}</View>;
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
  },
  panel: {
    backgroundColor: '#F1F5F9',
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  mainText: {
    fontSize: 15,
    fontWeight: '600',
    color: GinitTheme.colors.text,
  },
  subText: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
  },
});
