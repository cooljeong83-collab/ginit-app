import { useCallback } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import type { ActiveNoticeItem } from '@/src/features/notices/notices-api';
import { navigateFromNoticeLink } from '@/src/features/notices/notice-link-navigation';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';

const ACCENT = '#673AB7';

type Props = {
  items: ActiveNoticeItem[];
};

export function HomeNoticeBanner({ items }: Props) {
  const router = useTransitionRouter();

  const onPressItem = useCallback(
    (item: ActiveNoticeItem) => {
      navigateFromNoticeLink(router, { noticeId: item.id, linkUrl: item.linkUrl });
    },
    [router],
  );

  if (items.length === 0) return null;

  if (items.length === 1) {
    const item = items[0]!;
    return (
      <GinitPressable
        onPress={() => onPressItem(item)}
        style={({ pressed }) => [styles.banner, pressed && styles.bannerPressed]}
        accessibilityRole="button"
        accessibilityLabel={`공지 ${item.title}`}>
        <GinitSymbolicIcon name="megaphone-outline" size={18} color={ACCENT} />
        <Text style={styles.bannerTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <GinitSymbolicIcon name="chevron-forward" size={16} color={GinitTheme.colors.textMuted} />
      </GinitPressable>
    );
  }

  return (
    <FlatList
      horizontal
      data={items}
      keyExtractor={(it) => it.id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.carouselContent}
      renderItem={({ item }) => (
        <GinitPressable
          onPress={() => onPressItem(item)}
          style={({ pressed }) => [styles.banner, styles.bannerCarousel, pressed && styles.bannerPressed]}
          accessibilityRole="button"
          accessibilityLabel={`공지 ${item.title}`}>
          <GinitSymbolicIcon name="megaphone-outline" size={18} color={ACCENT} />
          <Text style={styles.bannerTitle} numberOfLines={1}>
            {item.title}
          </Text>
        </GinitPressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  carouselContent: {
    paddingHorizontal: 20,
    gap: 8,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: ACCENT,
    backgroundColor: '#F3E5F5',
  },
  bannerCarousel: {
    marginHorizontal: 0,
    minWidth: 260,
    maxWidth: 300,
  },
  bannerPressed: {
    opacity: 0.88,
  },
  bannerTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#311B92',
  },
});
