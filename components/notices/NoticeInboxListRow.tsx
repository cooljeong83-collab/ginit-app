import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import {
  noticeInboxDisplayStyles,
  noticeHeadlineText,
} from '@/components/notices/noticeInboxDisplay';
import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitTheme } from '@/constants/ginit-theme';
import {
  formatNoticeDate,
  isNoticeNew,
  type NoticeInboxListItem,
} from '@/src/features/notices/notices-api';

const THUMB_SIZE = 72;
const THUMB_RADIUS = 10;

export type NoticeInboxListRowProps = {
  item: NoticeInboxListItem;
  onPress: () => void;
};

export function NoticeInboxListRow({ item, onPress }: NoticeInboxListRowProps) {
  const previewText = noticeHeadlineText(item);
  const showNewPrefix = !item.isRead && isNoticeNew(item.inboxCreatedAt);
  const dateLabel = formatNoticeDate(item.noticeCreatedAt || item.inboxCreatedAt);
  const showThumb = item.isImageOnly && Boolean(item.imageUrl?.trim());

  return (
    <GinitPressable
      onPress={onPress}
      style={({ pressed }) => [styles.pressableRow, pressed && styles.pressablePressed]}
      accessibilityRole="button"
      accessibilityLabel={`공지 ${previewText}`}>
      <View style={styles.row}>
        <View style={styles.main}>
          {dateLabel ? (
            <Text style={noticeInboxDisplayStyles.date} numberOfLines={1}>
              {dateLabel}
            </Text>
          ) : null}
          <Text
            style={[
              noticeInboxDisplayStyles.headline,
              !item.isRead && noticeInboxDisplayStyles.headlineUnread,
            ]}
            numberOfLines={3}>
            {showNewPrefix ? <Text style={styles.newPrefix}>NEW </Text> : null}
            {previewText}
          </Text>
        </View>
        {showThumb ? (
          <View style={styles.thumbWrap}>
            <Image
              source={{ uri: item.imageUrl! }}
              style={styles.thumb}
              contentFit="cover"
            />
          </View>
        ) : null}
      </View>
    </GinitPressable>
  );
}

const styles = StyleSheet.create({
  pressableRow: {
    paddingVertical: 12,
  },
  pressablePressed: {
    opacity: 0.86,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  main: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  newPrefix: {
    fontSize: 11,
    fontWeight: '700',
    color: GinitTheme.colors.primary,
    letterSpacing: -0.1,
  },
  thumbWrap: {
    flexShrink: 0,
    overflow: 'hidden',
    borderRadius: THUMB_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    backgroundColor: GinitTheme.colors.bgAlt,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
  },
});
