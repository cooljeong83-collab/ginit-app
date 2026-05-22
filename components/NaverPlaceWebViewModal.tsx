import { GinitPressable } from '@/components/ui/GinitPressable';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { GinitPlaceRatingBadge } from '@/components/places/GinitPlaceRatingBadge';
import { GinitPlaceReviewTimeline } from '@/components/places/GinitPlaceReviewTimeline';
import { GinitStyles } from '@/constants/GinitStyles';
import { GinitTheme } from '@/constants/ginit-theme';
import { normalizeNaverPlaceDetailWebUrl } from '@/src/lib/naver-local-search';
import {
  buildPlaceWebViewCacheKey,
  isPlaceWebViewLoaded,
  markPlaceWebViewLoaded,
} from '@/src/lib/place-detail-webview-session-cache';
import { buildPlaceLookupKeys } from '@/src/lib/places/place-lookup-keys';
import type { PlaceLookupInput } from '@/src/lib/places/place-lookup-keys';
import { fetchPlaceMasterByLookup } from '@/src/lib/places/place-master-api';
import {
  fetchPlacePromotionsByKeys,
  pickPlacePromotion,
} from '@/src/lib/promotions/place-promotions-api';
import type { PlacePromotionSummary } from '@/src/lib/promotions/place-promotion-types';

/** 네이버 모바일 검색·플레이스 페이지가 인앱 UA에서 어긋나지 않도록 쓰는 모바일 Safari UA */
const NAVER_PLACE_WEBVIEW_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

export type NaverPlaceWebViewModalFooterAction = {
  label: string;
  onPress: () => void;
};

export type NaverPlaceWebViewModalProps = {
  visible: boolean;
  url: string | null | undefined;
  pageTitle?: string;
  onClose: () => void;
  /** 지닛 후기 탭·타이틀 💜 평점 (모임 상세 장소 팝업 등) */
  placeReviewLookup?: PlaceLookupInput | null;
  /** 하단 평면 CTA (`places` 등록 장소 — 이 장소로 모임 만들기 등) */
  footerAction?: NaverPlaceWebViewModalFooterAction | null;
};

type PlaceWebModalTab = 'web' | 'comments';

/**
 * 네이버 모바일 **통합검색** 등 장소 관련 URL을 앱 내 WebView로 표시합니다.
 * 화면 세로 **90%** 높이의 중앙 팝업(등록 마법사·모임 상세·장소 검색 등 공통).
 */
export function NaverPlaceWebViewModal({
  visible,
  url,
  pageTitle = '상세 정보',
  onClose,
  placeReviewLookup = null,
  footerAction = null,
}: NaverPlaceWebViewModalProps) {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [webLoading, setWebLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<PlaceWebModalTab>('web');
  const [ginitAvg, setGinitAvg] = useState(0);
  const [ginitReviewCount, setGinitReviewCount] = useState(0);
  const [ginitPromo, setGinitPromo] = useState<PlacePromotionSummary | null>(null);
  const initialLoadSettledRef = useRef(false);

  const showGinitTabs = placeReviewLookup != null && placeReviewLookup.placeKey.trim().length > 0;

  const reviewLookupBundle = useMemo(() => {
    if (!placeReviewLookup) return null;
    const keys = buildPlaceLookupKeys(placeReviewLookup);
    return {
      placeKey: placeReviewLookup.placeKey,
      lookupKeys: keys,
      placeName: placeReviewLookup.placeName,
      roadAddress: placeReviewLookup.roadAddress,
    };
  }, [placeReviewLookup]);

  const safeUrl = typeof url === 'string' && url.trim().length > 0 ? url.trim() : null;
  const webViewUri = safeUrl ? normalizeNaverPlaceDetailWebUrl(safeUrl) : null;
  const cacheKey = webViewUri
    ? buildPlaceWebViewCacheKey(webViewUri, placeReviewLookup?.placeKey)
    : null;

  const maxSheet = Math.max(280, windowHeight - insets.top - insets.bottom - 24);
  const sheetHeight = Math.round(Math.min(windowHeight * 0.9, maxSheet));

  useEffect(() => {
    if (!visible) {
      setTab('web');
      setGinitAvg(0);
      setGinitReviewCount(0);
      setGinitPromo(null);
      return;
    }
    if (!webViewUri || !cacheKey) return;

    setLoadError(null);
    if (isPlaceWebViewLoaded(cacheKey)) {
      initialLoadSettledRef.current = true;
      setWebLoading(false);
    } else {
      initialLoadSettledRef.current = false;
      setWebLoading(true);
    }
  }, [visible, webViewUri, cacheKey]);

  useEffect(() => {
    if (!visible || !placeReviewLookup) return;
    const placeKey = placeReviewLookup.placeKey.trim();
    let alive = true;
    void (async () => {
      const [master, promoMap] = await Promise.all([
        fetchPlaceMasterByLookup(placeReviewLookup),
        fetchPlacePromotionsByKeys(placeKey ? [placeKey] : []),
      ]);
      if (!alive) return;
      if (master) {
        setGinitAvg(master.averageRating);
        setGinitReviewCount(master.reviewCount);
      } else {
        setGinitAvg(0);
        setGinitReviewCount(0);
      }
      setGinitPromo(pickPlacePromotion(promoMap, placeKey));
    })();
    return () => {
      alive = false;
    };
  }, [visible, placeReviewLookup]);

  useEffect(() => {
    if (!visible || !webViewUri || !cacheKey || !webLoading) return;
    const timeout = setTimeout(() => {
      initialLoadSettledRef.current = true;
      markPlaceWebViewLoaded(cacheKey);
      setWebLoading(false);
    }, 8000);
    return () => clearTimeout(timeout);
  }, [visible, webViewUri, cacheKey, webLoading]);

  const handleClose = useCallback(() => {
    setLoadError(null);
    setTab('web');
    onClose();
  }, [onClose]);

  const settleInitialLoad = useCallback(() => {
    if (!cacheKey) return;
    initialLoadSettledRef.current = true;
    markPlaceWebViewLoaded(cacheKey);
    setWebLoading(false);
  }, [cacheKey]);

  const showWebTab = !showGinitTabs || tab === 'web';
  const showHeaderRatingBadge =
    showGinitTabs && (ginitReviewCount > 0 || ginitPromo?.isSponsored === true);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
        <GestureHandlerRootView style={styles.gestureRoot}>
          <View style={[styles.modalRootCentered, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
            <GinitPressable
              style={GinitStyles.modalBackdrop}
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="닫기"
            />
            <View
              style={[
                GinitStyles.modalSheet,
                styles.sheetChrome,
                {
                  height: sheetHeight,
                  maxHeight: sheetHeight,
                  paddingBottom: Math.max(12, insets.bottom + 6),
                  paddingHorizontal: 0,
                },
              ]}>
              <View style={[GinitStyles.modalHeader, styles.sheetHeaderPad]}>
                <View style={styles.headerLeftSlot}>
                  <GinitPressable onPress={handleClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="닫기">
                    <Text style={GinitStyles.modalCancel}>닫기</Text>
                  </GinitPressable>
                </View>
                <View style={styles.headerTitleWrap}>
                  <Text style={styles.headerPlaceTitle} numberOfLines={1}>
                    {pageTitle}
                  </Text>
                </View>
                <View style={styles.headerRightSlot}>
                  {showHeaderRatingBadge ? (
                    <GinitPlaceRatingBadge
                      averageRating={ginitAvg}
                      reviewCount={ginitReviewCount}
                      promotion={ginitPromo}
                      style={styles.headerRatingBadge}
                    />
                  ) : null}
                </View>
              </View>

              {showGinitTabs ? (
                <View style={styles.tabBar}>
                  <GinitPressable
                    onPress={() => setTab('web')}
                    style={[styles.tabBtn, tab === 'web' && styles.tabBtnActive]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: tab === 'web' }}>
                    <Text style={[styles.tabText, tab === 'web' && styles.tabTextActive]}>네이버 플레이스</Text>
                  </GinitPressable>
                  <GinitPressable
                    onPress={() => setTab('comments')}
                    style={[styles.tabBtn, tab === 'comments' && styles.tabBtnActive]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: tab === 'comments' }}>
                    <Text style={[styles.tabText, tab === 'comments' && styles.tabTextActive]}>
                      코멘트{ginitReviewCount > 0 ? ` (${ginitReviewCount})` : ''}
                    </Text>
                  </GinitPressable>
                </View>
              ) : null}

              {showGinitTabs && tab === 'comments' && reviewLookupBundle ? (
                <View style={styles.commentsBody}>
                  <GinitPlaceReviewTimeline
                    placeKey={reviewLookupBundle.placeKey}
                    lookupKeys={reviewLookupBundle.lookupKeys}
                    placeName={reviewLookupBundle.placeName}
                    roadAddress={reviewLookupBundle.roadAddress}
                  />
                </View>
              ) : webViewUri && showWebTab ? (
                <View style={styles.webOuter}>
                  <WebView
                    key={cacheKey ?? webViewUri}
                    source={{ uri: webViewUri }}
                    userAgent={NAVER_PLACE_WEBVIEW_USER_AGENT}
                    style={styles.webview}
                    cacheEnabled
                    cacheMode={Platform.OS === 'android' ? 'LOAD_CACHE_ELSE_NETWORK' : undefined}
                    onLoadStart={() => {
                      if (!initialLoadSettledRef.current && cacheKey && !isPlaceWebViewLoaded(cacheKey)) {
                        setWebLoading(true);
                      }
                      setLoadError(null);
                    }}
                    onLoadProgress={({ nativeEvent }) => {
                      if (nativeEvent.progress >= 0.85) settleInitialLoad();
                    }}
                    onLoadEnd={settleInitialLoad}
                    onHttpError={() => {
                      settleInitialLoad();
                      setLoadError('페이지를 불러오지 못했습니다.');
                    }}
                    onError={() => {
                      settleInitialLoad();
                      setLoadError('페이지를 불러오지 못했습니다.');
                    }}
                    startInLoadingState={false}
                    allowsBackForwardNavigationGestures={Platform.OS === 'ios'}
                    setSupportMultipleWindows={false}
                    mixedContentMode="compatibility"
                    originWhitelist={['http://', 'https://']}
                  />
                  {webLoading ? (
                    <View style={styles.loadingOverlay} pointerEvents="none">
                      <ActivityIndicator size="large" color={GinitTheme.colors.primary} />
                    </View>
                  ) : null}
                  {loadError ? (
                    <View style={styles.errorBanner}>
                      <Text style={styles.errorText}>{loadError}</Text>
                    </View>
                  ) : null}
                </View>
              ) : (
                <View style={styles.emptyBody}>
                  <Text style={styles.emptyText}>표시할 링크가 없어요.</Text>
                  <GinitPressable
                    onPress={handleClose}
                    style={({ pressed }) => [styles.emptyClose, pressed && { opacity: 0.88 }]}
                    accessibilityRole="button"
                    accessibilityLabel="닫기">
                    <Text style={GinitStyles.modalCancel}>닫기</Text>
                  </GinitPressable>
                </View>
              )}
              {footerAction?.label?.trim() ? (
                <View style={styles.footerActionWrap}>
                  <GinitPressable
                    onPress={footerAction.onPress}
                    style={({ pressed }) => [styles.footerActionBtn, pressed && { opacity: 0.88 }]}
                    accessibilityRole="button"
                    accessibilityLabel={footerAction.label}>
                    <Text style={styles.footerActionText}>{footerAction.label}</Text>
                  </GinitPressable>
                </View>
              ) : null}
            </View>
          </View>
        </GestureHandlerRootView>
      </Modal>
  );
}

const styles = StyleSheet.create({
  gestureRoot: { flex: 1 },
  modalRootCentered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'stretch',
    paddingHorizontal: GinitTheme.spacing.md,
  },
  sheetChrome: {
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  sheetHeaderPad: {
    paddingHorizontal: 16,
    marginBottom: 0,
  },
  headerLeftSlot: {
    minWidth: 48,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerTitleWrap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  headerPlaceTitle: {
    width: '100%',
    fontSize: 16,
    fontWeight: '800',
    color: GinitTheme.colors.text,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  headerRightSlot: {
    minWidth: 56,
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  headerRatingBadge: {
    flexShrink: 0,
  },
  tabBar: {
    flexDirection: 'row',
    flexShrink: 0,
    marginHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(15, 23, 42, 0.12)',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabBtnActive: {
    borderBottomColor: GinitTheme.colors.deepPurple,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
  },
  tabTextActive: {
    color: GinitTheme.colors.deepPurple,
    fontWeight: '800',
  },
  commentsBody: {
    flex: 1,
    minHeight: 0,
    marginHorizontal: 12,
    marginBottom: 4,
  },
  webOuter: {
    flex: 1,
    minHeight: 200,
    marginHorizontal: 12,
    marginBottom: 4,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: GinitTheme.colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  webview: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GinitTheme.glassModal.veil,
  },
  errorBanner: {
    position: 'absolute',
    left: GinitTheme.spacing.sm,
    right: GinitTheme.spacing.sm,
    bottom: GinitTheme.spacing.sm,
    padding: GinitTheme.spacing.md,
    borderRadius: GinitTheme.radius.button,
    backgroundColor: GinitTheme.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
  },
  errorText: {
    fontSize: 14,
    fontWeight: '700',
    color: GinitTheme.colors.textMuted,
    textAlign: 'center',
  },
  emptyBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: GinitTheme.spacing.lg,
    gap: GinitTheme.spacing.md,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '700',
    color: GinitTheme.colors.textMuted,
    textAlign: 'center',
  },
  emptyClose: { paddingVertical: 8, paddingHorizontal: 12 },
  footerActionWrap: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GinitTheme.colors.border,
  },
  footerActionBtn: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GinitTheme.colors.primary,
    borderRadius: 4,
  },
  footerActionText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
