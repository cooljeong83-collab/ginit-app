import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitTheme } from '@/constants/ginit-theme';
import {
  fetchPlaceReviewsByPlaceKey,
  type PlaceReviewTimelineItem,
} from '@/src/lib/places/place-master-api';

type GinitPlaceReviewTimelineProps = {
  placeKey: string;
  lookupKeys?: string[];
  placeName?: string;
  roadAddress?: string;
};

function nicknameInitial(name: string): string {
  return name.trim().slice(0, 1) || '회';
}

function TimelineRow({ item }: { item: PlaceReviewTimelineItem }) {
  const name = item.displayName.trim() || '회원';
  const comment = item.comment?.trim() ?? '';
  const keywords = item.selectedKeywords.filter(Boolean);

  return (
    <View style={styles.row}>
      {item.avatarUrl ? (
        <Image source={{ uri: item.avatarUrl }} style={styles.avatar} contentFit="cover" />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.avatarInitial}>{nicknameInitial(name)}</Text>
        </View>
      )}
      <View style={styles.body}>
        <View style={styles.topLine}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.rating}>💜 {item.rating}</Text>
        </View>
        {comment ? (
          <Text style={styles.comment} numberOfLines={3}>
            {comment}
          </Text>
        ) : null}
        {keywords.length > 0 ? (
          <ScrollView
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chipScrollContent}>
            {keywords.map((kw) => (
              <View key={kw} style={styles.chip}>
                <Text style={styles.chipText} numberOfLines={1}>
                  {kw}
                </Text>
              </View>
            ))}
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

export function GinitPlaceReviewTimeline({
  placeKey,
  lookupKeys,
  placeName,
  roadAddress,
}: GinitPlaceReviewTimelineProps) {
  const [items, setItems] = useState<PlaceReviewTimelineItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReset = useCallback(async () => {
    const key = placeKey.trim();
    if (!key) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPlaceReviewsByPlaceKey(key, {
        limit: 20,
        cursor: null,
        lookupKeys,
        placeName,
        roadAddress,
      });
      setItems(res.items);
      setCursor(res.nextCursor);
    } catch {
      setError('후기를 불러오지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, [placeKey, lookupKeys, placeName, roadAddress]);

  const loadMore = useCallback(async () => {
    const key = placeKey.trim();
    if (!key || !cursor) return;
    setLoadingMore(true);
    try {
      const res = await fetchPlaceReviewsByPlaceKey(key, {
        limit: 20,
        cursor,
        lookupKeys,
        placeName,
        roadAddress,
      });
      setItems((prev) => [...prev, ...res.items]);
      setCursor(res.nextCursor);
    } catch {
      setError('후기를 불러오지 못했어요.');
    } finally {
      setLoadingMore(false);
    }
  }, [placeKey, cursor, lookupKeys, placeName, roadAddress]);

  useEffect(() => {
    setItems([]);
    setCursor(null);
    void loadReset();
  }, [loadReset]);

  if (loading && items.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={GinitTheme.colors.deepPurple} />
      </View>
    );
  }

  if (!loading && items.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>아직 지닛 후기가 없어요.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(it) => it.id}
      renderItem={({ item }) => <TimelineRow item={item} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      onEndReached={() => {
        if (cursor && !loadingMore) void loadMore();
      }}
      onEndReachedThreshold={0.3}
      ListFooterComponent={
        loadingMore ? (
          <View style={styles.footer}>
            <ActivityIndicator color={GinitTheme.colors.deepPurple} />
          </View>
        ) : error ? (
          <View style={styles.footer}>
            <Text style={styles.errorText}>{error}</Text>
            <GinitPressable onPress={() => void loadReset()} accessibilityRole="button">
              <Text style={styles.retry}>다시 시도</Text>
            </GinitPressable>
          </View>
        ) : null
      }
      contentContainerStyle={styles.listContent}
      style={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  listContent: { paddingBottom: 16 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  empty: {
    fontSize: 14,
    color: GinitTheme.colors.textMuted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  separator: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(15, 23, 42, 0.1)',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarFallback: {
    backgroundColor: GinitTheme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 15,
    fontWeight: '700',
    color: GinitTheme.colors.deepPurple,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  topLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  name: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: GinitTheme.colors.text,
  },
  rating: {
    fontSize: 14,
    fontWeight: '800',
    color: GinitTheme.colors.deepPurple,
  },
  comment: {
    fontSize: 14,
    lineHeight: 20,
    color: GinitTheme.colors.textSub,
  },
  chipScroll: {
    flexGrow: 0,
    marginHorizontal: -4,
  },
  chipScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  chip: {
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: GinitTheme.colors.primarySoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(69, 39, 160, 0.15)',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.deepPurple,
  },
  footer: {
    paddingVertical: 16,
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    fontSize: 13,
    color: GinitTheme.colors.textMuted,
  },
  retry: {
    fontSize: 13,
    fontWeight: '700',
    color: GinitTheme.colors.deepPurple,
  },
});
