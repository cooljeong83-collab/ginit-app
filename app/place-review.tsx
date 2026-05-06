import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PlaceHalfStarRating } from '@/components/place/PlaceHalfStarRating';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { isLedgerMeetingId } from '@/src/lib/meetings-ledger';
import { upsertMyPlaceReview } from '@/src/lib/place-rating-supabase';

const VIBE_TAGS = [
  '조용해요',
  '분위기 좋아요',
  '직원 친절해요',
  '가성비 좋아요',
  '청결해요',
  '대기 짧아요',
  '단체에 맞아요',
  '다시 올래요',
] as const;

function pickParam(v: string | string[] | undefined): string {
  if (v == null) return '';
  return Array.isArray(v) ? (v[0] ?? '').trim() : String(v).trim();
}

export default function PlaceReviewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    meetingId?: string | string[];
    placeKey?: string | string[];
    placeName?: string | string[];
  }>();
  const { userId } = useUserSession();

  const meetingId = pickParam(params.meetingId);
  const placeKey = pickParam(params.placeKey);
  const placeName = pickParam(params.placeName);

  const [rating, setRating] = useState(4.0);
  const [selectedVibes, setSelectedVibes] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  const titleLine = useMemo(() => {
    const n = placeName || '이 장소';
    return `${n} — 장소는 어땠나요?`;
  }, [placeName]);

  const toggleVibe = useCallback((tag: string) => {
    setSelectedVibes((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);

  const onSubmit = useCallback(async () => {
    const uid = userId?.trim() ?? '';
    if (!uid) {
      Alert.alert('안내', '로그인 후 이용해 주세요.');
      return;
    }
    if (!meetingId || !placeKey) {
      Alert.alert('안내', '모임 또는 장소 정보가 없어요.');
      return;
    }
    if (!isLedgerMeetingId(meetingId)) {
      Alert.alert(
        '안내',
        '장소 리뷰는 Supabase에 저장된 모임(UUID)에서만 남길 수 있어요. (레거시 모임은 추후 지원 예정)',
      );
      return;
    }
    setBusy(true);
    try {
      const r = await upsertMyPlaceReview({
        appUserId: uid,
        placeKey,
        meetingId,
        rating,
        vibeTags: [...selectedVibes],
      });
      if (!r.ok) {
        Alert.alert('저장 실패', r.message);
        return;
      }
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)');
    } finally {
      setBusy(false);
    }
  }, [userId, meetingId, placeKey, rating, selectedVibes, router]);

  const onBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [router]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.topRow}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button">
          <Text style={styles.back}>← 닫기</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.head}>{titleLine}</Text>
        <PlaceHalfStarRating value={rating} onChange={setRating} />
        <Text style={styles.sectionLabel}>무드 태그</Text>
        <View style={styles.chipWrap}>
          {VIBE_TAGS.map((tag) => {
            const on = selectedVibes.has(tag);
            return (
              <Pressable
                key={tag}
                onPress={() => toggleVibe(tag)}
                style={[styles.chip, on && styles.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{tag}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          onPress={() => void onSubmit()}
          disabled={busy}
          style={({ pressed }) => [styles.cta, pressed && !busy && styles.ctaPressed, busy && styles.ctaDisabled]}
          accessibilityRole="button">
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.ctaLabel}>리뷰 저장</Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const DEEP_PURPLE = GinitTheme.colors.deepPurple;
const CHIP_BORDER = '#E2E8F0';

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
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  head: {
    fontSize: 20,
    fontWeight: '700',
    color: GinitTheme.colors.text,
    marginBottom: 20,
  },
  sectionLabel: {
    marginTop: 28,
    marginBottom: 12,
    fontSize: 14,
    fontWeight: '700',
    color: GinitTheme.colors.textSub,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    borderRadius: 4,
  },
  chipOn: {
    backgroundColor: DEEP_PURPLE,
    borderColor: DEEP_PURPLE,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.text,
  },
  chipTextOn: {
    color: '#FFFFFF',
  },
  cta: {
    marginTop: 32,
    backgroundColor: DEEP_PURPLE,
    paddingVertical: 16,
    alignItems: 'center',
    borderRadius: 4,
  },
  ctaPressed: {
    opacity: 0.88,
  },
  ctaDisabled: {
    opacity: 0.6,
  },
  ctaLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
