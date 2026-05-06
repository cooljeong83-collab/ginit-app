import { useCallback, useEffect, useRef } from 'react';
import { FlatList, type ListRenderItem, type NativeScrollEvent, type NativeSyntheticEvent, View, useWindowDimensions } from 'react-native';

import { MeetingChatImageViewerZoomArea } from '@/components/chat/MeetingChatImageViewerZoomArea';
import { meetingChatBodyStyles as styles } from '@/components/chat/meeting-chat-body-styles';

/** 채팅 메시지·프로필 사진 등 이미지 URL + 안정 id만 있으면 페이징 뷰어에 사용 */
export type ImageViewerGalleryItem = {
  id: string;
  imageUrl?: string | null;
};

type Props = {
  gallery: ImageViewerGalleryItem[];
  initialIndex: number;
  onIndexChange: (index: number) => void;
};

export function MeetingChatImageViewerGallery({ gallery, initialIndex, onIndexChange }: Props) {
  const { width: pageW } = useWindowDimensions();
  const listRef = useRef<FlatList<ImageViewerGalleryItem>>(null);

  const scrollToIdx = useCallback(
    (idx: number, animated: boolean) => {
      const n = gallery.length;
      if (n === 0 || pageW <= 0) return;
      const i = Math.max(0, Math.min(n - 1, Math.floor(idx)));
      try {
        listRef.current?.scrollToIndex({ index: i, animated });
      } catch {
        listRef.current?.scrollToOffset({ offset: i * pageW, animated });
      }
    },
    [gallery.length, pageW],
  );

  useEffect(() => {
    if (gallery.length === 0 || pageW <= 0) return;
    const i = Math.min(gallery.length - 1, Math.max(0, Math.floor(initialIndex)));
    const t = requestAnimationFrame(() => scrollToIdx(i, false));
    return () => cancelAnimationFrame(t);
  }, [gallery, initialIndex, pageW, scrollToIdx]);

  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const i = Math.round(x / Math.max(1, pageW));
      onIndexChange(Math.max(0, Math.min(gallery.length - 1, i)));
    },
    [gallery.length, onIndexChange, pageW],
  );

  const renderItem: ListRenderItem<ImageViewerGalleryItem> = useCallback(
    ({ item }) => {
      const u = item.imageUrl?.trim() ?? '';
      if (!u) return <View style={[styles.viewerPagerPage, { width: pageW }]} />;
      return (
        <View style={[styles.viewerPagerPage, { width: pageW }]}>
          <MeetingChatImageViewerZoomArea uri={u} />
        </View>
      );
    },
    [pageW],
  );

  if (gallery.length === 0 || pageW <= 0) {
    return null;
  }

  const initialIx = gallery.length > 0 ? Math.min(gallery.length - 1, Math.max(0, Math.floor(initialIndex))) : 0;

  return (
    <FlatList
      ref={listRef}
      data={gallery}
      keyExtractor={(m) => m.id}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      renderItem={renderItem}
      onMomentumScrollEnd={onMomentumScrollEnd}
      getItemLayout={(_, index) => ({
        length: pageW,
        offset: pageW * index,
        index,
      })}
      initialScrollIndex={gallery.length > 0 ? initialIx : 0}
      style={styles.viewerPagerList}
      initialNumToRender={2}
      windowSize={5}
      removeClippedSubviews={false}
      onScrollToIndexFailed={({ index }) => {
        requestAnimationFrame(() => scrollToIdx(index, false));
      }}
    />
  );
}
