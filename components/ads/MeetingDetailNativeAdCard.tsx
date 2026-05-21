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

/** 썸네일 박스 세로 고정 — 가로는 `mediaContent.aspectRatio`(W/H)로 계산 */
const DETAIL_MEDIA_HEIGHT = 96;
const DETAIL_MEDIA_MIN_WIDTH = 72;
const DETAIL_MEDIA_MAX_WIDTH = 132;
/** 모임 상세 장소 썸네일(`placeResultImageWrap`)과 동일 */
const DETAIL_MEDIA_RADIUS = 12;

/** Google 네이티브 광고 `mediaContent.aspectRatio` = 너비/높이 */
function detailAdMediaBoxDimensions(aspectRatio: number | null | undefined): { width: number; height: number } {
  const height = DETAIL_MEDIA_HEIGHT;
  const ar =
    typeof aspectRatio === 'number' && Number.isFinite(aspectRatio) && aspectRatio > 0
      ? aspectRatio
      : 1;
  const width = Math.min(
    DETAIL_MEDIA_MAX_WIDTH,
    Math.max(DETAIL_MEDIA_MIN_WIDTH, Math.round(height * ar)),
  );
  return { width, height };
}

const detailStyles = StyleSheet.create({
  card: {
    ...s.card,
    marginBottom: 20,
    padding: 9,
  },
  adRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  mediaCol: {
    flexShrink: 0,
    borderRadius: DETAIL_MEDIA_RADIUS,
    overflow: 'hidden',
    backgroundColor: 'rgba(15, 23, 42, 0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  mediaFill: {
    width: '100%',
    height: '100%',
  },
  textCol: {
    flex: 1,
    minWidth: 0,
    gap: 4,
    paddingTop: 2,
  },
  headline: {
    ...s.headline,
    fontSize: 14,
    marginBottom: 0,
  },
  body: {
    ...s.body,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 0,
  },
  ctaText: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.primary,
    marginTop: 2,
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

  const mediaBox = detailAdMediaBoxDimensions(nativeAd.mediaContent?.aspectRatio);

  return (
    <View style={[detailStyles.card, { minHeight: mediaBox.height + 18 }]}>
      <Text style={s.adLabel} accessibilityLabel="광고">
        광고
      </Text>
      <NativeAdView nativeAd={nativeAd} style={detailStyles.adRow}>
        <View
          style={[
            detailStyles.mediaCol,
            { width: mediaBox.width, height: mediaBox.height },
          ]}>
          <NativeMediaView resizeMode="cover" style={detailStyles.mediaFill} />
        </View>
        <View style={detailStyles.textCol}>
          <NativeAsset assetType={NativeAssetType.HEADLINE}>
            <Text style={detailStyles.headline} numberOfLines={2}>
              {nativeAd.headline?.trim() || nativeAd.advertiser?.trim() || '스폰서 콘텐츠'}
            </Text>
          </NativeAsset>
          {nativeAd.body?.trim() ? (
            <NativeAsset assetType={NativeAssetType.BODY}>
              <Text style={detailStyles.body} numberOfLines={3}>
                {nativeAd.body.trim()}
              </Text>
            </NativeAsset>
          ) : null}
          <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
            <Text style={detailStyles.ctaText} numberOfLines={1}>
              {nativeAd.callToAction?.trim() || '자세히 보기'}
            </Text>
          </NativeAsset>
        </View>
      </NativeAdView>
    </View>
  );
}
