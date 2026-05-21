import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import {
  formatNoticeDate,
  isNoticeNew,
  type NoticeInboxListItem,
} from '@/src/features/notices/notices-api';

const ACCENT = '#673AB7';
const THUMB_SIZE = 56;

export type NoticeInboxListRowProps = {
  item: NoticeInboxListItem;
  onPress: () => void;
};

export function NoticeInboxListRow({ item, onPress }: NoticeInboxListRowProps) {
  const isNew = !item.isRead && isNoticeNew(item.inboxCreatedAt);
  const dateLabel = formatNoticeDate(item.inboxCreatedAt);
  const hasImage = Boolean(item.imageUrl?.trim());

  return (
    <GinitPressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`공지 ${item.title}`}>
      <View style={styles.lead}>
        {hasImage ? (
          <Image source={{ uri: item.imageUrl! }} style={styles.thumb} contentFit="cover" />
        ) : (
          <View style={styles.symbolRing}>
            <GinitSymbolicIcon name="megaphone-outline" size={22} color={ACCENT} />
          </View>
        )}
      </View>
      <View style={styles.main}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, !item.isRead && styles.titleUnread]} numberOfLines={2}>
            {item.title}
          </Text>
          {isNew ? (
            <View style={styles.newBadge}>
              <Text style={styles.newBadgeText}>NEW</Text>
            </View>
          ) : null}
          {!item.isRead && !isNew ? <View style={styles.unreadDot} /> : null}
        </View>
        {dateLabel ? <Text style={styles.date}>{dateLabel}</Text> : null}
      </View>
      <GinitSymbolicIcon name="chevron-forward" size={18} color={GinitTheme.colors.textMuted} />
    </GinitPressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: GinitTheme.colors.border,
  },
  rowPressed: {
    opacity: 0.9,
  },
  lead: {
    width: THUMB_SIZE,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
  },
  symbolRing: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: 1,
    borderColor: ACCENT,
    backgroundColor: '#F3E5F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  main: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: GinitTheme.colors.text,
  },
  titleUnread: {
    fontWeight: '700',
  },
  date: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '500',
    color: GinitTheme.colors.textMuted,
  },
  newBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: ACCENT,
  },
  newBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#fff',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ACCENT,
    marginTop: 6,
  },
});
