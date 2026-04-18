import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GinitCard } from '@/components/ginit';
import { GinitTheme } from '@/constants/ginit-theme';
import type { Meeting } from '@/src/lib/meetings';
import { subscribeMeetings } from '@/src/lib/meetings';

const CATEGORIES = ['전체', '커피', '와인', '영화'] as const;

const DEFAULT_THUMB =
  'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=400&h=400&fit=crop&q=80';

export default function FeedScreen() {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('전체');
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeMeetings(
      (list) => {
        setMeetings(list);
        setListError(null);
        setLoading(false);
      },
      (msg) => {
        setListError(msg);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  return (
    <LinearGradient colors={['#DCEEFF', '#F6FAFF', '#FFF4ED']} locations={[0, 0.45, 1]} style={styles.gradient}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Pressable style={styles.locationRow} accessibilityRole="button">
              <Text style={styles.locationText}>영등포</Text>
              <Ionicons name="chevron-down" size={18} color={GinitTheme.trustBlue} />
            </Pressable>
            <View style={styles.headerActions}>
              <Pressable accessibilityRole="button" hitSlop={10}>
                <Ionicons name="search-outline" size={24} color="#0f172a" />
              </Pressable>
              <Pressable accessibilityRole="button" hitSlop={10} style={styles.bellWrap}>
                <Ionicons name="notifications-outline" size={24} color="#0f172a" />
                <View style={styles.badge} />
              </Pressable>
            </View>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
            style={styles.chipsScroll}>
            {CATEGORIES.map((c) => {
              const active = c === category;
              return (
                <Pressable
                  key={c}
                  onPress={() => setCategory(c)}
                  style={[styles.chip, active ? styles.chipActive : styles.chipIdle]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}>
                  <Text style={[styles.chipLabel, active ? styles.chipLabelActive : styles.chipLabelIdle]}>{c}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <GinitCard style={styles.heroCard}>
            <View style={styles.heroInner}>
              <View style={styles.heroCopy}>
                <Text style={styles.heroTitle}>AI가 제안하는 완벽한 모임!</Text>
                <Text style={styles.heroDesc}>
                  오늘 저녁, 영등포에서 #와인_애호가들과 함께 어떠세요? 바로 참여해보세요.
                </Text>
              </View>
              <View style={styles.heroArt} accessibilityLabel="AI 추천">
                <Text style={styles.heroEmoji}>🤖</Text>
                <Text style={styles.heroSparkle}>✨</Text>
              </View>
            </View>
          </GinitCard>

          <Text style={styles.sectionLabel}>모임</Text>

          {loading ? (
            <View style={styles.centerRow}>
              <ActivityIndicator />
              <Text style={styles.muted}>불러오는 중…</Text>
            </View>
          ) : null}

          {listError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>목록을 불러오지 못했어요</Text>
              <Text style={styles.errorBody}>{listError}</Text>
            </View>
          ) : null}

          {!loading && !listError && meetings.length === 0 ? (
            <Text style={styles.empty}>등록된 모임이 없습니다. + 버튼으로 첫 모임을 만들어 보세요.</Text>
          ) : null}

          {meetings.map((m) => (
            <Pressable key={m.id} style={styles.meetRow} accessibilityRole="button">
              <Image
                source={{ uri: m.imageUrl?.trim() ? m.imageUrl.trim() : DEFAULT_THUMB }}
                style={styles.thumb}
                contentFit="cover"
              />
              <View style={styles.meetBody}>
                <View style={styles.meetTop}>
                  <Text style={styles.meetTitle} numberOfLines={1}>
                    {m.title}
                  </Text>
                  <Text style={styles.distance} numberOfLines={2}>
                    {m.address?.trim() || m.location}
                  </Text>
                </View>
                <View style={styles.tagRow}>
                  <View style={styles.tagPill}>
                    <Text style={styles.tagText} numberOfLines={1}>
                      {[m.categoryLabel, `최대 ${m.capacity}명`].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  {m.isPublic === false ? (
                    <View style={styles.lockPill}>
                      <Text style={styles.lockPillText}>비공개</Text>
                    </View>
                  ) : null}
                </View>
                {m.scheduleDate && m.scheduleTime ? (
                  <Text style={styles.schedule} numberOfLines={1}>
                    {m.scheduleDate} {m.scheduleTime}
                  </Text>
                ) : null}
                <Text style={styles.price} numberOfLines={2}>
                  {m.description}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  safe: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingTop: 4,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  locationText: {
    fontSize: 20,
    fontWeight: '700',
    color: GinitTheme.trustBlue,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  bellWrap: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: GinitTheme.pointOrange,
    borderWidth: 1,
    borderColor: '#fff',
  },
  chipsScroll: {
    marginBottom: 18,
    marginHorizontal: -4,
  },
  chipsRow: {
    gap: 10,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  chip: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 2,
  },
  chipActive: {
    backgroundColor: GinitTheme.trustBlue,
    borderColor: GinitTheme.trustBlue,
  },
  chipIdle: {
    backgroundColor: '#FFFFFF',
    borderColor: GinitTheme.pointOrange,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  chipLabelActive: {
    color: '#FFFFFF',
  },
  chipLabelIdle: {
    color: GinitTheme.pointOrange,
  },
  heroCard: {
    marginBottom: 22,
  },
  heroInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  heroCopy: {
    flex: 1,
    gap: 8,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  heroDesc: {
    fontSize: 14,
    lineHeight: 20,
    color: '#475569',
  },
  heroArt: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 82, 204, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(0, 82, 204, 0.2)',
  },
  heroEmoji: {
    fontSize: 36,
  },
  heroSparkle: {
    position: 'absolute',
    top: 6,
    right: 8,
    fontSize: 14,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 12,
  },
  centerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  muted: {
    fontSize: 14,
    color: '#64748b',
  },
  errorBox: {
    marginBottom: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(220, 38, 38, 0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(220, 38, 38, 0.25)',
  },
  errorTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#B91C1C',
    marginBottom: 6,
  },
  errorBody: {
    fontSize: 14,
    color: '#7F1D1D',
    lineHeight: 20,
  },
  empty: {
    fontSize: 14,
    color: '#64748b',
    lineHeight: 20,
    marginBottom: 12,
  },
  meetRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: 20,
    padding: 12,
    marginBottom: 14,
    gap: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  thumb: {
    width: 88,
    height: 88,
    borderRadius: 16,
    backgroundColor: '#e2e8f0',
  },
  meetBody: {
    flex: 1,
    justifyContent: 'center',
    gap: 6,
  },
  meetTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  meetTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  distance: {
    maxWidth: '40%',
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    textAlign: 'right',
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  tagPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  lockPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 82, 204, 0.1)',
  },
  lockPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: GinitTheme.trustBlue,
  },
  schedule: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  price: {
    fontSize: 13,
    fontWeight: '500',
    color: '#334155',
    lineHeight: 18,
  },
});
