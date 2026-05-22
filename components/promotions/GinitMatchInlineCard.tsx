import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { GinitMatchBenefitBadge } from '@/components/promotions/GinitMatchBenefitBadge';
import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { MEETING_LIST_IMAGE_BLURHASH } from '@/src/lib/expo-image-meeting-placeholder';
import type { FeedSponsoredPlace } from '@/src/lib/promotions/place-promotion-types';

const THUMB_SIZE = 70;
const THUMB_RADIUS = 10;

type Props = {
  place: FeedSponsoredPlace;
  onPress: () => void;
};

/**
 * 탐색 피드 인라인 제휴 매치 카드 — HomeMeetingListItem과 동일 행 높이·구조, 플랫 스타일.
 */
export function GinitMatchInlineCard({ place, onPress }: Props) {
  const thumbUri = place.preferredPhotoMediaUrl?.trim() || null;
  const badgeLabel = place.benefitLabel.trim() || place.badgeLabel.trim() || '지닛 매치 추천';
  const subLine = [place.category, place.roadAddress].filter(Boolean).join(' · ');

  return (
    <GinitPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${place.placeName} 제휴 장소 상세`}
      style={({ pressed }) => [s.pressableRow, s.cardBorder, pressed && s.pressablePressed]}>
      <View style={s.row}>
        <View style={s.lead}>
          <View style={s.symbolRing}>
            {thumbUri ? (
              <Image
                source={{ uri: thumbUri }}
                style={s.symbolPhoto}
                contentFit="cover"
                transition={140}
                cachePolicy="disk"
                placeholder={{ blurhash: MEETING_LIST_IMAGE_BLURHASH }}
              />
            ) : (
              <GinitSymbolicIcon name="location-outline" size={34} color={GinitTheme.colors.primary} />
            )}
          </View>
        </View>
        <View style={s.body}>
          <View style={s.titleRow}>
            <Text style={s.title} numberOfLines={2}>
              {place.placeName}
            </Text>
            <View style={s.badgeSlot}>
              <GinitMatchBenefitBadge label={badgeLabel} compact />
            </View>
          </View>
          {subLine ? (
            <Text style={s.sub} numberOfLines={2}>
              {subLine}
            </Text>
          ) : null}
          <Text style={s.hint} numberOfLines={1}>
            지닛 제휴 장소 · 탭하여 상세 보기
          </Text>
        </View>
      </View>
    </GinitPressable>
  );
}

const s = StyleSheet.create({
  pressableRow: {
    paddingVertical: 10,
  },
  cardBorder: {
    borderWidth: 1.5,
    borderColor: GinitTheme.colors.primary,
    borderRadius: 0,
    marginHorizontal: 0,
  },
  pressablePressed: {
    opacity: 0.86,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 0,
  },
  lead: {
    width: THUMB_SIZE,
    flexShrink: 0,
    alignItems: 'center',
    paddingTop: 1,
  },
  symbolRing: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_RADIUS,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GinitTheme.colors.primarySoft,
  },
  symbolPhoto: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 4,
    paddingTop: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    fontWeight: '700',
    color: GinitTheme.colors.text,
    letterSpacing: -0.2,
  },
  badgeSlot: {
    flexShrink: 0,
    maxWidth: '46%',
  },
  sub: {
    fontSize: 13,
    fontWeight: '500',
    color: GinitTheme.colors.textSub,
    lineHeight: 18,
  },
  hint: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.primary,
  },
});
