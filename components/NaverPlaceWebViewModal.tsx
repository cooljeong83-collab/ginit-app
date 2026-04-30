import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { GinitStyles } from '@/constants/GinitStyles';
import { GinitTheme } from '@/constants/ginit-theme';
import { normalizeNaverPlaceDetailWebUrl } from '@/src/lib/naver-local-search';

/** 네이버 모바일 검색·플레이스 페이지가 인앱 UA에서 어긋나지 않도록 쓰는 모바일 Safari UA */
const NAVER_PLACE_WEBVIEW_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

export type NaverPlaceWebViewModalProps = {
  visible: boolean;
  url: string | null | undefined;
  pageTitle?: string;
  onClose: () => void;
};

/**
 * 네이버 모바일 **통합검색** 등 장소 관련 URL을 앱 내 WebView로 표시합니다.
 * 화면 세로 **90%** 높이의 중앙 팝업(등록 마법사·모임 상세·장소 검색 등 공통).
 */
export function NaverPlaceWebViewModal({ visible, url, pageTitle = '상세 정보', onClose }: NaverPlaceWebViewModalProps) {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [webLoading, setWebLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const safeUrl = typeof url === 'string' && url.trim().length > 0 ? url.trim() : null;
  const webViewUri = safeUrl ? normalizeNaverPlaceDetailWebUrl(safeUrl) : null;

  useEffect(() => {
    if (visible && webViewUri) {
      setWebLoading(true);
      setLoadError(null);
    }
  }, [visible, webViewUri]);

  const handleClose = useCallback(() => {
    setWebLoading(true);
    setLoadError(null);
    onClose();
  }, [onClose]);

  const maxSheet = Math.max(280, windowHeight - insets.top - insets.bottom - 24);
  const sheetHeight = Math.round(Math.min(windowHeight * 0.9, maxSheet));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <GestureHandlerRootView style={styles.gestureRoot}>
        <View style={[styles.modalRootCentered, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
          <Pressable
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
              <Pressable onPress={handleClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="닫기">
                <Text style={GinitStyles.modalCancel}>닫기</Text>
              </Pressable>
              <View style={styles.headerTitleWrap}>
                <Text style={GinitStyles.modalTitle} numberOfLines={1}>
                  {pageTitle}
                </Text>
              </View>
              <View style={styles.headerRightSpacer} />
            </View>

            {webViewUri ? (
              <View style={styles.webOuter}>
                <WebView
                  key={webViewUri}
                  source={{ uri: webViewUri }}
                  userAgent={NAVER_PLACE_WEBVIEW_USER_AGENT}
                  style={styles.webview}
                  onLoadStart={() => {
                    setWebLoading(true);
                    setLoadError(null);
                  }}
                  onLoadEnd={() => setWebLoading(false)}
                  onHttpError={() => {
                    setWebLoading(false);
                    setLoadError('페이지를 불러오지 못했습니다.');
                  }}
                  onError={() => {
                    setWebLoading(false);
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
                <Pressable
                  onPress={handleClose}
                  style={({ pressed }) => [styles.emptyClose, pressed && { opacity: 0.88 }]}
                  accessibilityRole="button"
                  accessibilityLabel="닫기">
                  <Text style={GinitStyles.modalCancel}>닫기</Text>
                </Pressable>
              </View>
            )}
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
  /** `modalSheet` 상단만 둥근 기본값을 카드형으로 보이도록 네 모서리 통일 */
  sheetChrome: {
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    overflow: 'hidden',
  },
  sheetHeaderPad: {
    paddingHorizontal: 16,
    marginBottom: 0,
  },
  headerTitleWrap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  /** 왼쪽 `닫기`와 폭을 맞춰 제목을 가운데 정렬 */
  headerRightSpacer: { minWidth: 44 },
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
});
