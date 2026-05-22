import { GinitPressable } from '@/components/ui/GinitPressable';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import {
  LEGAL_DOCUMENT_TITLES,
  LEGAL_DOCUMENT_URLS,
  type LegalDocumentKey,
} from '@/src/constants/legal-documents';

const LEGAL_WEBVIEW_INJECTED_JS = `
(function() {
  var style = document.createElement('style');
  style.textContent = 'body{margin:0;padding:16px;background:#fff;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;line-height:1.55;} h1,h2,h3{color:#0f172a;} a{color:#4527A0;}';
  document.head.appendChild(style);
})();
true;
`;

export type LegalDocumentModalProps = {
  visible: boolean;
  doc: LegalDocumentKey | null;
  onClose: () => void;
};

export function LegalDocumentModal({ visible, doc, onClose }: LegalDocumentModalProps) {
  const [webLoading, setWebLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const initialLoadSettledRef = useRef(false);

  const uri = doc ? LEGAL_DOCUMENT_URLS[doc] : null;
  const title = doc ? LEGAL_DOCUMENT_TITLES[doc] : '';

  useEffect(() => {
    if (!visible) {
      setWebLoading(true);
      setLoadError(null);
      initialLoadSettledRef.current = false;
    }
  }, [visible, doc]);

  const settleInitialLoad = useCallback(() => {
    if (initialLoadSettledRef.current) return;
    initialLoadSettledRef.current = true;
    setWebLoading(false);
  }, []);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const webViewKey = useMemo(() => (doc && uri ? `${doc}:${uri}` : 'empty'), [doc, uri]);

  return (
    <Modal
      visible={visible && doc != null}
      animationType="slide"
      onRequestClose={handleClose}
      presentationStyle="fullScreen">
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <GinitPressable onPress={handleClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="닫기">
            <GinitSymbolicIcon name="close" size={22} color={GinitTheme.colors.text} />
          </GinitPressable>
        </View>

        <View style={styles.body}>
          {uri ? (
            <>
              <WebView
                key={webViewKey}
                source={{ uri }}
                style={styles.webview}
                injectedJavaScriptBeforeContentLoaded={LEGAL_WEBVIEW_INJECTED_JS}
                onLoadStart={() => {
                  if (!initialLoadSettledRef.current) setWebLoading(true);
                  setLoadError(null);
                }}
                onLoadProgress={({ nativeEvent }) => {
                  if (nativeEvent.progress >= 0.85) settleInitialLoad();
                }}
                onLoadEnd={settleInitialLoad}
                onHttpError={() => {
                  settleInitialLoad();
                  setLoadError('문서를 불러오지 못했습니다.');
                }}
                onError={() => {
                  settleInitialLoad();
                  setLoadError('문서를 불러오지 못했습니다.');
                }}
                startInLoadingState={false}
                allowsBackForwardNavigationGestures={Platform.OS === 'ios'}
                setSupportMultipleWindows={false}
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
            </>
          ) : (
            <View style={styles.emptyBody}>
              <Text style={styles.emptyText}>표시할 문서가 없습니다.</Text>
            </View>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(15, 23, 42, 0.10)',
  },
  title: { flex: 1, fontSize: 16, fontWeight: '600', color: '#0f172a', marginRight: 8 },
  body: { flex: 1, position: 'relative' },
  webview: { flex: 1, backgroundColor: '#fff' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
  },
  errorBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(220, 38, 38, 0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(220, 38, 38, 0.22)',
  },
  errorText: { fontSize: 13, fontWeight: '600', color: '#b91c1c', textAlign: 'center' },
  emptyBody: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { fontSize: 14, fontWeight: '600', color: '#64748b' },
});
