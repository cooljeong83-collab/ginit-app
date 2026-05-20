import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import {
  formatSupportAnnouncementDate,
  isSupportAnnouncementNew,
  type SupportAnnouncementListItem,
} from '@/src/features/support/support-announcements-api';

const THUMB_SIZE = 70;
const THUMB_RADIUS = 10;
/** 썸네일 없을 때 — 제목·일시 블록 높이에 맞춘 심볼 */
const SYMBOL_LEAD_SIZE = 44;
const SYMBOL_ICON_SIZE = 22;

export type SupportAnnouncementListRowProps = {
  item: SupportAnnouncementListItem;
  onPress: () => void;
};

export function SupportAnnouncementListRow({ item, onPress }: SupportAnnouncementListRowProps) {
  const isNew = isSupportAnnouncementNew(item.publishedAt);
  const dateLabel = formatSupportAnnouncementDate(item.publishedAt);
  const hasImage = Boolean(item.imageUrl?.trim());
  const leadSize = hasImage ? THUMB_SIZE : SYMBOL_LEAD_SIZE;

  return (
    <GinitPressable
      onPress={onPress}
      style={({ pressed }) => [styles.pressableRow, pressed && styles.pressablePressed]}
      accessibilityRole="button"
      accessibilityLabel={`공지 ${item.title}`}>
      <View style={styles.row}>
        <View style={[styles.lead, { width: leadSize }]}>
          <View
            style={[
              styles.symbolRing,
              { width: leadSize, height: leadSize, borderRadius: hasImage ? THUMB_RADIUS : leadSize / 2 },
            ]}>
            {hasImage ? (
              <Image
                source={{ uri: item.imageUrl! }}
                style={{ width: leadSize, height: leadSize }}
                contentFit="cover"
              />
            ) : (
              <GinitSymbolicIcon
                name="megaphone-outline"
                size={SYMBOL_ICON_SIZE}
                color={GinitTheme.colors.textMuted}
              />
            )}
          </View>
        </View>
        <View style={styles.main}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={2}>
              {isNew ? (
                <Text style={styles.newPrefix}>NEW </Text>
              ) : null}
              {item.title}
            </Text>
          </View>
          {dateLabel ? (
            <Text style={styles.meta} numberOfLines={1}>
              {dateLabel}
            </Text>
          ) : null}
        </View>
      </View>
    </GinitPressable>
  );
}

const styles = StyleSheet.create({
  pressableRow: {
    paddingVertical: 10,
  },
  pressablePressed: {
    opacity: 0.86,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  lead: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  symbolRing: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GinitTheme.colors.bgAlt,
  },
  main: {
    flex: 1,
    minWidth: 0,
    gap: 4,
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
    lineHeight: 18,
    color: GinitTheme.colors.text,
  },
  newPrefix: {
    fontSize: 11,
    fontWeight: '700',
    color: GinitTheme.colors.primary,
    letterSpacing: -0.1,
  },
  meta: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    letterSpacing: -0.12,
    lineHeight: 15,
  },
});
