import * as MediaLibrary from 'expo-media-library';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { meetingChatBodyStyles } from '@/components/chat/meeting-chat-body-styles';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';

const MAX_SELECT = 20;
const PAGE_SIZE = 60;

/**
 * `getAssetsAsync`는 `sortBy`에 `[키, DESC여부]` 튜플을 넣을 때 **한 겹 더 배열**로 감싸야 합니다.
 * `[SortBy.creationTime, false]`만 넘기면 `arrayize` 후 `false`가 별도 키로 처리되어 `invalid sortBy key: false`가 납니다.
 */
const ASSET_SORT_NEWEST_FIRST: MediaLibrary.SortByValue[] = [[MediaLibrary.SortBy.creationTime, false]];

/** OS·앨범별 정렬 차이를 줄이기 위해 그리드에는 항상 촬영/생성 시각 최신순을 강제 */
function sortAssetsNewestFirst(list: MediaLibrary.Asset[]): MediaLibrary.Asset[] {
  return [...list].sort((a, b) => {
    const dc = (b.creationTime ?? 0) - (a.creationTime ?? 0);
    if (dc !== 0) return dc;
    return (b.modificationTime ?? 0) - (a.modificationTime ?? 0);
  });
}

async function requestMediaReadPermission(): Promise<boolean> {
  const perm =
    Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version >= 33
      ? await (MediaLibrary.requestPermissionsAsync as (w: boolean, g?: string[]) => Promise<MediaLibrary.PermissionResponse>)(
          false,
          ['photo'],
        )
      : await MediaLibrary.requestPermissionsAsync(false);
  return perm.granted === true;
}

async function resolveAssetUriForUpload(asset: MediaLibrary.Asset): Promise<{ uri: string; width?: number }> {
  const w = typeof asset.width === 'number' && asset.width > 0 ? asset.width : undefined;
  if (Platform.OS === 'android' && asset.uri?.startsWith('file')) {
    return { uri: asset.uri, width: w };
  }
  const info = await MediaLibrary.getAssetInfoAsync(asset.id, {
    shouldDownloadFromNetwork: true,
  });
  const local = (info.localUri ?? info.uri ?? '').trim();
  if (!local) {
    throw new Error('이미지를 읽지 못했어요.');
  }
  const iw = typeof info.width === 'number' && info.width > 0 ? info.width : w;
  return { uri: local, width: iw };
}

export type MeetingChatMediaPickerModalProps = {
  visible: boolean;
  onClose: () => void;
  sendBusy: boolean;
  onConfirmSend: (payload: { uris: string[]; widths: (number | undefined)[] }) => Promise<void>;
};

export function MeetingChatMediaPickerModal({
  visible,
  onClose,
  sendBusy,
  onConfirmSend,
}: MeetingChatMediaPickerModalProps) {
  const { width: winW, height: winH } = useWindowDimensions();
  const halfSheetHeight = Math.round(winH * 0.5);
  const fullSheetHeight = Math.round(winH);
  const sheetHeight = useSharedValue(halfSheetHeight);
  const sheetHalfH = useSharedValue(halfSheetHeight);
  const sheetFullH = useSharedValue(fullSheetHeight);
  const panOriginH = useSharedValue(halfSheetHeight);
  const dismissShiftY = useSharedValue(0);
  const backdropOpacity = useSharedValue(0);
  const windowH = useSharedValue(winH);
  const closingSV = useSharedValue(0);
  const closingRef = useRef(false);
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const [endCursor, setEndCursor] = useState<string | undefined>(undefined);
  const [hasNextPage, setHasNextPage] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<string[]>([]);
  const [resolvingSend, setResolvingSend] = useState(false);
  const [albums, setAlbums] = useState<MediaLibrary.Album[]>([]);
  const [albumPickerOpen, setAlbumPickerOpen] = useState(false);
  /** `null`이면 라이브러리 전체 사진 */
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [photoTotalCount, setPhotoTotalCount] = useState(0);
  /** 전체보기 기준 사진 총장(드롭다운 첫 줄 표시용) */
  const [allLibraryPhotoCount, setAllLibraryPhotoCount] = useState(0);

  useEffect(() => {
    windowH.value = winH;
    const half = Math.round(winH * 0.5);
    const full = Math.round(winH);
    sheetHalfH.value = half;
    sheetFullH.value = full;
    const cur = sheetHeight.value;
    const snapHalf = Math.abs(cur - half) <= Math.abs(cur - full);
    sheetHeight.value = snapHalf ? half : full;
  }, [winH, windowH, sheetHalfH, sheetFullH, sheetHeight]);

  const finishDismiss = useCallback(() => {
    closingRef.current = false;
    onClose();
  }, [onClose]);

  const requestDismiss = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    closingSV.value = 1;
    setAlbumPickerOpen(false);
    backdropOpacity.value = withTiming(0, { duration: 260, easing: Easing.in(Easing.quad) });
    const target = windowH.value + 24;
    dismissShiftY.value = withTiming(target, { duration: 300, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(finishDismiss)();
    });
  }, [finishDismiss, dismissShiftY, windowH, closingSV, backdropOpacity]);

  const assetById = useMemo(() => {
    const m = new Map<string, MediaLibrary.Asset>();
    for (const a of assets) {
      m.set(a.id, a);
    }
    return m;
  }, [assets]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .failOffsetX([-28, 28])
        .activeOffsetY([-10, 10])
        .onBegin(() => {
          'worklet';
          if (closingSV.value === 1) return;
          panOriginH.value = sheetHeight.value;
        })
        .onUpdate((e) => {
          'worklet';
          if (closingSV.value === 1) return;
          const half = sheetHalfH.value;
          const full = sheetFullH.value;
          const next = panOriginH.value - e.translationY;
          sheetHeight.value = Math.min(full, Math.max(half, next));
        })
        .onEnd((e) => {
          'worklet';
          if (closingSV.value === 1) return;
          const half = sheetHalfH.value;
          const full = sheetFullH.value;
          const mid = (half + full) * 0.5;
          const y = sheetHeight.value;
          const vy = e.velocityY ?? 0;
          const startedHalf = panOriginH.value <= half + 2;
          const startedFull = panOriginH.value >= full - 2;
          let dest: number;
          if (startedHalf && !startedFull) {
            dest = y > mid || vy < -400 ? full : half;
          } else if (startedFull && !startedHalf) {
            dest = y < mid || vy > 400 ? half : full;
          } else {
            dest = y >= mid ? full : half;
          }
          sheetHeight.value = withSpring(dest, { damping: 23, stiffness: 290 });
        }),
    [panOriginH, sheetHeight, sheetHalfH, sheetFullH, closingSV],
  );

  const sheetAnimStyle = useAnimatedStyle(() => ({
    height: sheetHeight.value,
    transform: [{ translateY: dismissShiftY.value }],
  }));

  const backdropAnimStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const gap = 2;
  const pad = 10;
  const cols = 3;
  const cell = Math.floor((winW - pad * 2 - gap * (cols - 1)) / cols);
  const albumMenuMaxH = Math.min(Math.round(winH * 0.38), 320);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setAssets([]);
    setEndCursor(undefined);
    setHasNextPage(true);
    setSelectedOrder([]);
    setAlbumPickerOpen(false);
    setSelectedAlbumId(null);
    setAlbums([]);
    setPhotoTotalCount(0);
    setAllLibraryPhotoCount(0);
    try {
      const ok = await requestMediaReadPermission();
      if (!ok) {
        setLoadError('사진 라이브러리 접근을 허용해 주세요.');
        return;
      }
      try {
        const raw = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: Platform.OS === 'ios' });
        const sorted = [...raw]
          .filter((a) => (a.assetCount ?? 0) > 0)
          .sort((a, b) => a.title.localeCompare(b.title, 'ko'));
        setAlbums(sorted);
      } catch {
        setAlbums([]);
      }
      const res = await MediaLibrary.getAssetsAsync({
        first: PAGE_SIZE,
        mediaType: MediaLibrary.MediaType.photo,
        sortBy: ASSET_SORT_NEWEST_FIRST,
      });
      setAssets(sortAssetsNewestFirst(res.assets));
      setEndCursor(res.endCursor);
      setHasNextPage(res.hasNextPage);
      const tc = typeof res.totalCount === 'number' ? res.totalCount : res.assets.length;
      setPhotoTotalCount(tc);
      setAllLibraryPhotoCount(tc);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '앨범을 불러오지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadGridForAlbum = useCallback(async (albumId: string | null) => {
    setAlbumPickerOpen(false);
    setSelectedAlbumId(albumId);
    setSelectedOrder([]);
    setLoading(true);
    setLoadError(null);
    setAssets([]);
    setEndCursor(undefined);
    setHasNextPage(true);
    try {
      const res = await MediaLibrary.getAssetsAsync({
        first: PAGE_SIZE,
        mediaType: MediaLibrary.MediaType.photo,
        sortBy: ASSET_SORT_NEWEST_FIRST,
        ...(albumId ? { album: albumId } : {}),
      });
      setAssets(sortAssetsNewestFirst(res.assets));
      setEndCursor(res.endCursor);
      setHasNextPage(res.hasNextPage);
      const tc = typeof res.totalCount === 'number' ? res.totalCount : res.assets.length;
      setPhotoTotalCount(tc);
      if (albumId == null) {
        setAllLibraryPhotoCount(tc);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '사진을 불러오지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) {
      setAssets([]);
      setEndCursor(undefined);
      setHasNextPage(true);
      setLoading(false);
      setLoadingMore(false);
      setLoadError(null);
      setSelectedOrder([]);
      setResolvingSend(false);
      setAlbums([]);
      setAlbumPickerOpen(false);
      setSelectedAlbumId(null);
      setPhotoTotalCount(0);
      setAllLibraryPhotoCount(0);
      closingRef.current = false;
      closingSV.value = 0;
      cancelAnimation(dismissShiftY);
      dismissShiftY.value = 0;
      cancelAnimation(backdropOpacity);
      backdropOpacity.value = 0;
      return;
    }
    closingRef.current = false;
    closingSV.value = 0;
    dismissShiftY.value = 0;
    sheetHeight.value = sheetHalfH.value;
    cancelAnimation(backdropOpacity);
    backdropOpacity.value = 0;
    backdropOpacity.value = withTiming(1, { duration: 240, easing: Easing.out(Easing.quad) });
    void loadInitial();
  }, [visible, loadInitial, sheetHalfH, closingSV, dismissShiftY, sheetHeight, backdropOpacity]);

  const loadMore = useCallback(async () => {
    if (!visible || !hasNextPage || loading || loadingMore) return;
    const cur = endCursor;
    if (!cur) return;
    setLoadingMore(true);
    try {
      const res = await MediaLibrary.getAssetsAsync({
        first: PAGE_SIZE,
        after: cur,
        mediaType: MediaLibrary.MediaType.photo,
        sortBy: ASSET_SORT_NEWEST_FIRST,
        ...(selectedAlbumId ? { album: selectedAlbumId } : {}),
      });
      setEndCursor(res.endCursor);
      setHasNextPage(res.hasNextPage);
      setAssets((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        const add = res.assets.filter((a) => !seen.has(a.id));
        return sortAssetsNewestFirst([...prev, ...add]);
      });
    } catch {
      /* ignore */
    } finally {
      setLoadingMore(false);
    }
  }, [visible, hasNextPage, loading, loadingMore, endCursor, selectedAlbumId]);

  const selectedAlbumTitle = useMemo(() => {
    if (selectedAlbumId == null) return '전체보기';
    return albums.find((a) => a.id === selectedAlbumId)?.title ?? '앨범';
  }, [albums, selectedAlbumId]);

  const albumPickerRows = useMemo(
    () => [{ type: 'all' as const }, ...albums.map((a) => ({ type: 'album' as const, album: a }))],
    [albums],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedOrder((prev) => {
      const i = prev.indexOf(id);
      if (i >= 0) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_SELECT) return prev;
      return [...prev, id];
    });
  }, []);

  const handleSend = useCallback(async () => {
    if (selectedOrder.length === 0 || sendBusy || resolvingSend) return;
    setResolvingSend(true);
    try {
      const ordered = selectedOrder.map((id) => assetById.get(id)).filter(Boolean) as MediaLibrary.Asset[];
      const resolved = await Promise.all(ordered.map((a) => resolveAssetUriForUpload(a)));
      await onConfirmSend({
        uris: resolved.map((r) => r.uri),
        widths: resolved.map((r) => r.width),
      });
    } catch (e) {
      Alert.alert('전송 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
    } finally {
      setResolvingSend(false);
    }
  }, [selectedOrder, assetById, sendBusy, resolvingSend, onConfirmSend]);

  const canSend = selectedOrder.length > 0;
  const headerBusy = sendBusy || resolvingSend;

  if (Platform.OS === 'web') {
    return null;
  }

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={requestDismiss}>
      <GestureHandlerRootView style={styles.gestureRoot}>
        <View style={styles.modalRoot}>
          <Animated.View style={[styles.backdropLayer, backdropAnimStyle]} pointerEvents="box-none">
            <BlurView
              tint="dark"
              intensity={GinitTheme.blur.intensityStrong}
              style={StyleSheet.absoluteFill}
              {...(Platform.OS === 'android' ? { experimentalBlurMethod: 'dimezisBlurView' as const } : {})}
            />
            <View style={[StyleSheet.absoluteFill, styles.backdropVeil]} pointerEvents="none" />
            <Pressable style={StyleSheet.absoluteFill} onPress={requestDismiss} accessibilityLabel="닫기" />
          </Animated.View>
          <Animated.View style={[styles.sheet, styles.sheetDocked, sheetAnimStyle]}>
            <SafeAreaView edges={['top', 'bottom']} style={styles.sheetInner}>
              <GestureDetector gesture={panGesture}>
                <View style={styles.handleStrip} accessibilityLabel="핸들을 위로 올리면 전체 화면, 전체 화면에서 아래로 내리면 절반 크기">
                  <View style={styles.handlePill} />
                </View>
              </GestureDetector>
              <View style={styles.header}>
                <Pressable onPress={requestDismiss} hitSlop={12} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="닫기">
                  <GinitSymbolicIcon name="close" size={22} color="#0f172a" />
                </Pressable>
                <View style={styles.headerCenter}>
                  <View style={styles.headerTitleRow}>
                    <Text style={styles.headerAlbumTitle} numberOfLines={1} ellipsizeMode="tail">
                      {selectedAlbumTitle}
                    </Text>
                    <Text
                      style={styles.headerAlbumCount}
                      numberOfLines={1}
                      accessibilityLabel={`사진 ${photoTotalCount.toLocaleString('ko-KR')}장`}>
                      {photoTotalCount.toLocaleString('ko-KR')}
                    </Text>
                    <Pressable
                      onPress={() => setAlbumPickerOpen((o) => !o)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      style={({ pressed }) => [styles.headerChevronBtn, pressed && meetingChatBodyStyles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel="앨범 목록"
                      accessibilityState={{ expanded: albumPickerOpen }}>
                      <GinitSymbolicIcon name="chevron-down" size={22} color="#0f172a" />
                    </Pressable>
                  </View>
                </View>
                <Pressable
                  onPress={() => void handleSend()}
                  disabled={!canSend || headerBusy}
                  style={({ pressed }) => [
                    styles.sendTop,
                    (!canSend || headerBusy) && styles.sendTopDisabled,
                    pressed && canSend && !headerBusy && meetingChatBodyStyles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="전송">
                  {headerBusy ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.sendTopText}>전송</Text>
                  )}
                </Pressable>
              </View>

              <View style={styles.sheetBodyColumn}>
                {albumPickerOpen ? (
                  <>
                    <Pressable
                      style={styles.albumPickerScrim}
                      onPress={() => setAlbumPickerOpen(false)}
                      accessibilityLabel="앨범 목록 닫기"
                    />
                    <View style={[styles.albumPickerMenu, { maxHeight: albumMenuMaxH }]}>
                      <FlatList
                        data={albumPickerRows}
                        style={{ maxHeight: albumMenuMaxH }}
                        keyboardShouldPersistTaps="handled"
                        keyExtractor={(item) => (item.type === 'all' ? 'all' : item.album.id)}
                        ItemSeparatorComponent={() => <View style={styles.albumRowSep} />}
                        renderItem={({ item }) => {
                          if (item.type === 'all') {
                            return (
                              <Pressable
                                onPress={() => void reloadGridForAlbum(null)}
                                style={({ pressed }) => [styles.albumRow, styles.albumRowLine, pressed && meetingChatBodyStyles.pressed]}
                                accessibilityRole="button"
                                accessibilityLabel="전체보기">
                                <Text style={styles.albumRowTitle}>전체보기</Text>
                                <Text style={styles.albumRowCount} accessibilityLabel={`사진 ${allLibraryPhotoCount.toLocaleString('ko-KR')}장`}>
                                  {allLibraryPhotoCount.toLocaleString('ko-KR')}
                                </Text>
                              </Pressable>
                            );
                          }
                          const ac = item.album.assetCount ?? 0;
                          return (
                            <Pressable
                              onPress={() => void reloadGridForAlbum(item.album.id)}
                              style={({ pressed }) => [styles.albumRow, styles.albumRowLine, pressed && meetingChatBodyStyles.pressed]}
                              accessibilityRole="button"
                              accessibilityLabel={item.album.title}>
                              <Text style={styles.albumRowTitleFlex} numberOfLines={1} ellipsizeMode="tail">
                                {item.album.title}
                              </Text>
                              <Text style={styles.albumRowCount} accessibilityLabel={`사진 ${ac.toLocaleString('ko-KR')}장`}>
                                {ac.toLocaleString('ko-KR')}
                              </Text>
                            </Pressable>
                          );
                        }}
                      />
                    </View>
                  </>
                ) : null}

              <View style={styles.sheetBody}>
            {loading ? (
              <View style={styles.centerFill}>
                <ActivityIndicator size="large" color={GinitTheme.colors.primary} />
                <Text style={styles.muted}>사진을 불러오는 중…</Text>
              </View>
            ) : loadError ? (
              <View style={styles.centerFill}>
                <Text style={styles.errorText}>{loadError}</Text>
                <Pressable onPress={() => void loadInitial()} style={styles.retryBtn}>
                  <Text style={styles.retryBtnText}>다시 시도</Text>
                </Pressable>
              </View>
            ) : assets.length === 0 ? (
              <View style={styles.centerFill}>
                <Text style={styles.muted}>표시할 사진이 없어요.</Text>
              </View>
            ) : (
              <FlatList
                style={styles.gridList}
                data={assets}
                keyExtractor={(item) => item.id}
                numColumns={cols}
                columnWrapperStyle={{ gap, paddingHorizontal: pad, marginBottom: gap }}
                contentContainerStyle={styles.listContent}
                onEndReached={() => void loadMore()}
                onEndReachedThreshold={0.35}
                ListFooterComponent={
                  loadingMore ? (
                    <View style={styles.footerLoading}>
                      <ActivityIndicator color={GinitTheme.colors.primary} />
                    </View>
                  ) : null
                }
                renderItem={({ item }) => {
                  const selected = selectedOrder.includes(item.id);
                  return (
                    <Pressable
                      onPress={() => toggleSelect(item.id)}
                      style={({ pressed }) => [
                        styles.cell,
                        { width: cell, height: cell },
                        pressed && meetingChatBodyStyles.pressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={selected ? '선택 해제' : '선택'}>
                      <Image source={{ uri: item.uri }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
                      {selected ? (
                        <View style={styles.selectedOverlay}>
                          <View style={styles.checkCircle}>
                            <GinitSymbolicIcon name="checkmark" size={16} color="#fff" />
                          </View>
                        </View>
                      ) : (
                        <View style={styles.unselectedRing} pointerEvents="none" />
                      )}
                    </Pressable>
                  );
                }}
              />
            )}
              </View>
              </View>
            </SafeAreaView>
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
  modalRoot: {
    flex: 1,
  },
  backdropLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  backdropVeil: {
    backgroundColor: GinitTheme.glass.overlayDark,
  },
  sheetDocked: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },
  sheet: {
    width: '100%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  sheetInner: {
    flex: 1,
    minHeight: 0,
  },
  handleStrip: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  handlePill: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#cbd5e1',
  },
  sheetBodyColumn: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  albumPickerScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    zIndex: 4,
  },
  albumPickerMenu: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    zIndex: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GinitTheme.colors.border,
  },
  albumRow: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  albumRowLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  albumRowSep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: GinitTheme.colors.border,
  },
  albumRowTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
    flexShrink: 0,
  },
  albumRowTitleFlex: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
    flex: 1,
    minWidth: 0,
  },
  albumRowCount: {
    fontSize: 16,
    fontWeight: '600',
    color: '#64748b',
    flexShrink: 0,
  },
  sheetBody: {
    flex: 1,
    minHeight: 0,
  },
  gridList: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GinitTheme.colors.border,
  },
  headerCenter: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: '100%',
    gap: 8,
  },
  headerAlbumTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    flexShrink: 1,
  },
  headerAlbumCount: {
    fontSize: 17,
    fontWeight: '600',
    color: '#64748b',
    flexShrink: 0,
  },
  headerChevronBtn: {
    width: 36,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendTop: {
    minWidth: 52,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: GinitTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendTopDisabled: {
    opacity: 0.45,
  },
  sendTopText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  centerFill: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    minHeight: 120,
  },
  muted: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    color: '#b91c1c',
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
  },
  retryBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
  },
  listContent: {
    paddingTop: 8,
    paddingBottom: 24,
  },
  cell: {
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#e2e8f0',
  },
  selectedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    padding: 6,
  },
  checkCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: GinitTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unselectedRing: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  footerLoading: {
    paddingVertical: 16,
  },
});
