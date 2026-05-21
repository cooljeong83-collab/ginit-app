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
import { useShouldShowAds } from '@/src/hooks/use-should-show-ads';
import { AD_UNIT_IDS } from '@/src/constants/adsConfig';

/** [`HomeMeetingListItem`](components/feed/HomeMeetingListItem.tsx)와 동일 */
const THUMB_SIZE = 70;
const THUMB_RADIUS = 10;

type FeedNativeAdCardProps = {
  unitId?: string;
};

/**
 * 탐색 모임 목록 행 — `HomeMeetingListItem`과 동일한 연속 리스트 양식(카드 박스 없음).
 */
export function FeedNativeAdCard({ unitId = AD_UNIT_IDS.nativeFeed }: FeedNativeAdCardProps) {
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

  if (!nativeAd) {
    return (
      <View style={s.pressableRow} accessibilityLabel="광고 로딩 중">
        <View style={s.row}>
          <View style={[s.symbolRing, s.thumbPlaceholder]} />
          <View style={s.main}>
            <View style={s.headRow}>
              <View style={s.titleCol} />
              <Text style={[s.status, s.statusDefault]}>광고</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  const headline =
    nativeAd.headline?.trim() || nativeAd.advertiser?.trim() || '스폰서 콘텐츠';
  const body = nativeAd.body?.trim() ?? '';
  const cta = nativeAd.callToAction?.trim() || '자세히 보기';

  return (
    <NativeAdView nativeAd={nativeAd} style={s.pressableRow}>
      <View style={s.row}>
        <View style={s.lead}>
          <View style={s.symbolRing} accessibilityLabel="광고 이미지">
            <NativeMediaView resizeMode="cover" style={s.symbolPhoto} />
          </View>
        </View>

        <View style={s.main}>
          <View style={s.headRow}>
            <View style={s.titleCol}>
              <NativeAsset assetType={NativeAssetType.HEADLINE}>
                <Text style={s.title} numberOfLines={2}>
                  {headline}
                </Text>
              </NativeAsset>
            </View>
            <Text style={[s.status, s.statusDefault]} accessibilityLabel="광고">
              광고
            </Text>
          </View>

          {body.length > 0 ? (
            <NativeAsset assetType={NativeAssetType.BODY}>
              <Text style={s.moduleWhen} numberOfLines={1}>
                {body}
              </Text>
            </NativeAsset>
          ) : null}

          <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
            <Text style={s.moduleCta} numberOfLines={1}>
              {cta}
            </Text>
          </NativeAsset>
        </View>
      </View>
    </NativeAdView>
  );
}

const s = StyleSheet.create({
  pressableRow: {
    paddingVertical: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
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
    backgroundColor: GinitTheme.colors.bgAlt,
  },
  thumbPlaceholder: {
    backgroundColor: 'rgba(15, 23, 42, 0.04)',
  },
  symbolPhoto: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_RADIUS - 1,
  },
  main: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  titleCol: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
    lineHeight: 18,
    color: GinitTheme.colors.text,
  },
  status: {
    flexShrink: 0,
    maxWidth: '34%',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: -0.12,
    textAlign: 'right',
    lineHeight: 14,
  },
  statusDefault: {
    color: GinitTheme.colors.textMuted,
  },
  moduleWhen: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.textSub,
    letterSpacing: -0.2,
    lineHeight: 15,
  },
  moduleCta: {
    fontSize: 11,
    fontWeight: '700',
    color: GinitTheme.colors.primary,
    letterSpacing: -0.1,
    lineHeight: 15,
  },
});
