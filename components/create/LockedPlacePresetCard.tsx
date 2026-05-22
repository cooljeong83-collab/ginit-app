import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PlaceCandidateDetailLinkRow } from '@/components/create/PlaceCandidateDetailLinkRow';
import { GinitPlaceRatingBadge } from '@/components/places/GinitPlaceRatingBadge';
import { voteCandidatesFormStyles as styles } from '@/components/create/vote-candidates-form-styles';
import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitTheme } from '@/constants/ginit-theme';
import { pickPlaceRating, usePlaceRatingsByKeys } from '@/src/hooks/use-place-ratings-by-keys';
import { arrivalVerifyPlaceChipToNaverImageFields } from '@/src/lib/meeting-arrival-verify-place-summary-data';
import type { PlaceCandidate } from '@/src/lib/meeting-place-bridge';
import { enrichPlaceCandidateWithKey } from '@/src/lib/places/place-key';
import { searchNaverPlaceImageThumbnail } from '@/src/lib/naver-image-search';
import { resolveHttpImageDisplayUri } from '@/src/lib/supabase-public-image-thumbnail';

type LockedPlacePresetCardProps = {
  place: PlaceCandidate;
  hintText: string;
  onOpenPlaceUrl?: (url: string, title: string) => void;
  onChangePlace?: () => void;
  changePlaceLabel?: string;
};

export function LockedPlacePresetCard({
  place,
  hintText,
  onOpenPlaceUrl,
  onChangePlace,
  changePlaceLabel = '장소 변경',
}: LockedPlacePresetCardProps) {
  const enriched = useMemo(() => enrichPlaceCandidateWithKey(place), [place]);
  const placeKey = enriched.placeKey ?? '';
  const ratingsQuery = usePlaceRatingsByKeys(placeKey ? [placeKey] : []);
  const rating = pickPlaceRating(ratingsQuery.data, placeKey);

  const preferred = enriched.preferredPhotoMediaUrl?.trim() || null;
  const [fallbackThumb, setFallbackThumb] = useState<string | null | undefined>(undefined);

  const naverFields = useMemo(
    () =>
      arrivalVerifyPlaceChipToNaverImageFields({
        id: 'preset-place',
        title: enriched.placeName,
        sub: enriched.address,
        category: enriched.category ?? undefined,
        preferredPhotoMediaUrl: preferred ?? undefined,
        naverPlaceLink: enriched.naverPlaceLink ?? undefined,
      }),
    [enriched, preferred],
  );

  useEffect(() => {
    if (preferred) {
      setFallbackThumb(undefined);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      void (async () => {
        try {
          const uri = await searchNaverPlaceImageThumbnail(naverFields);
          if (!alive) return;
          setFallbackThumb(uri);
        } catch {
          if (!alive) return;
          setFallbackThumb(null);
        }
      })();
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [preferred, naverFields]);

  const thumb = useMemo(() => {
    const raw =
      preferred ?? (fallbackThumb && fallbackThumb !== undefined ? fallbackThumb : null);
    return raw ? resolveHttpImageDisplayUri(raw, 192) : null;
  }, [preferred, fallbackThumb]);
  const cat = enriched.category?.trim();

  return (
    <View style={localStyles.wrap}>
      <Text style={styles.sectionHint}>{hintText}</Text>
      <View style={[styles.placeResultImageCard, styles.placeFieldRecess, localStyles.card]}>
        <View style={localStyles.row}>
          <View style={localStyles.thumbWrap}>
            {thumb ? (
              <Image source={{ uri: thumb }} style={localStyles.thumb} contentFit="cover" />
            ) : (
              <View style={[localStyles.thumb, localStyles.thumbFallback]} />
            )}
          </View>
          <View style={localStyles.col}>
            <View style={localStyles.titleRow}>
              <Text style={[styles.placeResultTitle, localStyles.titleFlex]} numberOfLines={2}>
                {enriched.placeName}
              </Text>
              {rating && rating.reviewCount > 0 ? (
                <GinitPlaceRatingBadge
                  averageRating={rating.averageRating}
                  reviewCount={rating.reviewCount}
                />
              ) : null}
            </View>
            {cat ? (
              <Text style={styles.placeResultAddr} numberOfLines={2}>
                {cat}
              </Text>
            ) : null}
            {enriched.address?.trim() ? (
              <Text style={styles.placeResultAddr} numberOfLines={3}>
                {enriched.address.trim()}
              </Text>
            ) : null}
            {onOpenPlaceUrl ? (
              <PlaceCandidateDetailLinkRow
                title={enriched.placeName}
                link={enriched.naverPlaceLink}
                addressLine={enriched.address}
                containerStyle={localStyles.detailLinks}
                onOpenUrl={onOpenPlaceUrl}
              />
            ) : null}
          </View>
        </View>
      </View>
      {onChangePlace ? (
        <GinitPressable
          onPress={onChangePlace}
          style={({ pressed }) => [localStyles.changeBtn, pressed && { opacity: 0.88 }]}
          accessibilityRole="button"
          accessibilityLabel={changePlaceLabel}>
          <Text style={localStyles.changeBtnText}>{changePlaceLabel}</Text>
        </GinitPressable>
      ) : null}
    </View>
  );
}

const localStyles = StyleSheet.create({
  wrap: {
    gap: 8,
    marginTop: 4,
  },
  card: {
    width: '100%',
    alignSelf: 'stretch',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  thumbWrap: {
    width: 96,
    height: 96,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  thumbFallback: {
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
  },
  col: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  titleFlex: {
    flex: 1,
    minWidth: 0,
  },
  detailLinks: {
    alignSelf: 'stretch',
    marginTop: 4,
  },
  changeBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  changeBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: GinitTheme.colors.primary,
  },
});
