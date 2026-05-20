import { useCallback, useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  MeetingChatImageViewerGallery,
  type ImageViewerGalleryItem,
} from '@/components/chat/MeetingChatImageViewerGallery';
import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';

type AdminReportEvidenceImageViewerProps = {
  visible: boolean;
  imageUrls: readonly string[];
  initialIndex: number;
  onClose: () => void;
};

export function AdminReportEvidenceImageViewer({
  visible,
  imageUrls,
  initialIndex,
  onClose,
}: AdminReportEvidenceImageViewerProps) {
  const insets = useSafeAreaInsets();
  const gallery = useMemo<ImageViewerGalleryItem[]>(
    () =>
      imageUrls
        .map((url, i) => ({ id: `report-evidence-${i}-${url}`, imageUrl: url }))
        .filter((item) => Boolean(item.imageUrl?.trim())),
    [imageUrls],
  );
  const [index, setIndex] = useState(() => Math.max(0, Math.min(initialIndex, gallery.length - 1)));

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  if (gallery.length === 0) {
    return null;
  }

  const safeIndex = Math.max(0, Math.min(index, gallery.length - 1));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <GestureHandlerRootView style={styles.root}>
        <GinitPressable
          style={StyleSheet.absoluteFill}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="닫기"
        />
        <View style={styles.sheet} pointerEvents="box-none">
          <View style={[styles.topRow, { paddingTop: insets.top + 8 }]}>
            <GinitPressable
              onPress={handleClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="닫기">
              <GinitSymbolicIcon name="close" size={26} color="#fff" />
            </GinitPressable>
            <Text style={styles.counter}>
              {safeIndex + 1} / {gallery.length}
            </Text>
          </View>
          <View style={styles.imageWrap}>
            <MeetingChatImageViewerGallery
              gallery={gallery}
              initialIndex={initialIndex}
              onIndexChange={setIndex}
            />
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
  },
  sheet: {
    flex: 1,
    paddingBottom: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 12,
  },
  counter: {
    flex: 1,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
  },
  imageWrap: {
    flex: 1,
    width: '100%',
    minHeight: 0,
  },
});
