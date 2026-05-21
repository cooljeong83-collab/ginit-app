import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import {
  NativeAd,
  NativeAdView,
  NativeAsset,
  NativeAssetType,
  NativeMediaView,
} from 'react-native-google-mobile-ads';

import { GinitTheme } from '@/constants/ginit-theme';
import { ginitNativeAdStyles as s } from '@/components/ads/ginit-native-ad-styles';
import { useShouldShowAds } from '@/src/hooks/use-should-show-ads';
import { AD_UNIT_IDS } from '@/src/constants/adsConfig';

type MeetingDetailNativeAdCardProps = {
  unitId?: string;
};

/** 모임 상세 전용 — 공용 `ginitNativeAdStyles` 대비 약 1/2 높이 */
const DETAIL_MEDIA_H = 70;
const DETAIL_CARD_MIN_H = 140;

const detailStyles = StyleSheet.create({
  card: {
    ...s.card,
    marginBottom: 20,
    minHeight: DETAIL_CARD_MIN_H,
    padding: 9,
  },
  media: {
    ...s.media,
    height: DETAIL_MEDIA_H,
    borderRadius: 8,
    marginBottom: 5,
  },
  headline: {
    ...s.headline,
    fontSize: 14,
    marginBottom: 2,
  },
  body: {
    ...s.body,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 6,
  },
  ctaText: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.primary,
  },
});

export function MeetingDetailNativeAdCard({
  unitId = AD_UNIT_IDS.nativeMeetingDetail,
}: MeetingDetailNativeAdCardProps) {
  const { shouldShowAds } = useShouldShowAds();
  const [nativeAd, setNativeAd] = useState<NativeAd | null>(null);

  useEffect(() => {
    if (!shouldShowAds || Platform.OS === 'web') return;
    let cancelled = false;
    let ad: NativeAd | null = null;

    void NativeAd.createForAdRequest(unitId)
      .then((loaded) => {
        if (cancelled) {
          loaded.destroy();
          return;
        }
        ad = loaded;
        setNativeAd(loaded);
      })
      .catch(() => {
        if (!cancelled) setNativeAd(null);
      });

    return () => {
      cancelled = true;
      ad?.removeAllAdEventListeners();
      ad?.destroy();
    };
  }, [unitId, shouldShowAds]);

  if (!shouldShowAds || Platform.OS === 'web') return null;
  if (!nativeAd) return null;

  return (
    <View style={detailStyles.card}>
      <Text style={s.adLabel} accessibilityLabel="광고">
        광고
      </Text>
      <NativeAdView nativeAd={nativeAd}>
        <NativeMediaView resizeMode="cover" style={detailStyles.media} />
        <NativeAsset assetType={NativeAssetType.HEADLINE}>
          <Text style={detailStyles.headline} numberOfLines={1}>
            {nativeAd.headline?.trim() || nativeAd.advertiser?.trim() || '스폰서 콘텐츠'}
          </Text>
        </NativeAsset>
        {nativeAd.body?.trim() ? (
          <NativeAsset assetType={NativeAssetType.BODY}>
            <Text style={detailStyles.body} numberOfLines={2}>
              {nativeAd.body.trim()}
            </Text>
          </NativeAsset>
        ) : null}
        <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
          <Text style={detailStyles.ctaText}>{nativeAd.callToAction?.trim() || '자세히 보기'}</Text>
        </NativeAsset>
      </NativeAdView>
    </View>
  );
}
