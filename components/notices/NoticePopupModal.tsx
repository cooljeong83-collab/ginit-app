import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image as RNImage,
  Modal,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import type { ActiveNoticeItem } from '@/src/features/notices/notices-api';

const ACCENT = '#673AB7';

type Props = {
  notice: ActiveNoticeItem;
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onSnoozeToday: () => void;
};

type ImageLayout = { width: number; height: number };

/** 카드(팝업) 안에서 비율 유지하며 가능한 한 크게 맞춤 — 상한만 적용, 작은 이미지는 확대 */
function fitImageLayout(iw: number, ih: number, maxW: number, maxH: number): ImageLayout {
  if (iw <= 0 || ih <= 0) return { width: maxW, height: Math.round(maxW * 0.6) };
  const scale = Math.min(maxW / iw, maxH / ih);
  return {
    width: Math.max(1, Math.round(iw * scale)),
    height: Math.max(1, Math.round(ih * scale)),
  };
}

export function NoticePopupModal({ notice, visible, onClose, onConfirm, onSnoozeToday }: Props) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLayout, setImageLayout] = useState<ImageLayout | null>(null);
  const [imageLayoutLoading, setImageLayoutLoading] = useState(false);

  const title = notice.title.trim();
  const body = notice.content.trim();
  const hasTitle = title.length > 0;
  const hasBody = body.length > 0;
  const hasLink = Boolean(notice.linkUrl?.trim());
  const imageUri = notice.imageUrl?.trim() ?? '';
  const showImage = imageUri.length > 0 && !imageFailed;
  const imageOnly = notice.isImageOnly && showImage;

  const cardMaxWidth = imageOnly ? windowWidth - 48 : Math.min(windowWidth - 48, 400);
  const imageMaxHeight = Math.max(160, Math.round(windowHeight * (imageOnly ? 0.78 : 0.68)));

  useEffect(() => {
    setImageFailed(false);
    setImageLayout(null);
    setImageLayoutLoading(false);
    if (!imageUri) return;

    let alive = true;
    setImageLayoutLoading(true);
    RNImage.getSize(
      imageUri,
      (iw, ih) => {
        if (!alive) return;
        setImageLayout(fitImageLayout(iw, ih, cardMaxWidth, imageMaxHeight));
        setImageLayoutLoading(false);
      },
      () => {
        if (!alive) return;
        setImageFailed(true);
        setImageLayout(null);
        setImageLayoutLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [notice.id, imageUri, cardMaxWidth, imageMaxHeight]);

  const resolvedImageLayout = useMemo((): ImageLayout | null => {
    if (!showImage) return null;
    if (imageLayout) return imageLayout;
    if (imageLayoutLoading) return { width: cardMaxWidth, height: Math.round(cardMaxWidth * 0.5) };
    return { width: cardMaxWidth, height: Math.round(cardMaxWidth * 0.5) };
  }, [showImage, imageLayout, imageLayoutLoading, cardMaxWidth]);

  const onCta = useCallback(() => {
    onConfirm();
  }, [onConfirm]);

  const onPressImage = useCallback(() => {
    if (hasLink) onConfirm();
  }, [hasLink, onConfirm]);

  const footerRow = (
    <View style={[styles.footerRow, imageOnly && styles.footerRowImageOnly]}>
      <GinitPressable
        onPress={onClose}
        style={({ pressed }) => [styles.footerTextBtn, pressed && styles.btnPressed]}
        accessibilityRole="button"
        accessibilityLabel="닫기"
        hitSlop={8}>
        <Text style={styles.footerTextClose}>닫기</Text>
      </GinitPressable>

      {hasLink && !imageOnly ? (
        <GinitPressable
          onPress={onCta}
          style={({ pressed }) => [styles.footerTextBtn, pressed && styles.btnPressed]}
          accessibilityRole="button"
          accessibilityLabel="자세히 보기"
          hitSlop={8}>
          <Text style={styles.footerTextLink}>자세히 보기</Text>
        </GinitPressable>
      ) : (
        <View style={styles.footerSpacer} />
      )}

      <GinitPressable
        onPress={onSnoozeToday}
        style={({ pressed }) => [styles.footerTextBtn, pressed && styles.btnPressed]}
        accessibilityRole="button"
        accessibilityLabel="오늘 하루 안 보기"
        hitSlop={8}>
        <Text style={styles.footerTextSnooze}>오늘 하루 안 보기</Text>
      </GinitPressable>
    </View>
  );

  const imageElement =
    showImage && resolvedImageLayout ? (
      <Image
        source={{ uri: imageUri }}
        style={styles.imageFill}
        contentFit="cover"
        onError={() => setImageFailed(true)}
      />
    ) : null;

  const mixedImageBlock =
    showImage && resolvedImageLayout ? (
      hasLink ? (
        <GinitPressable
          onPress={onPressImage}
          accessibilityRole="button"
          accessibilityLabel="공지 이미지, 탭하면 자세히 볼 수 있어요"
          style={({ pressed }) => [
            styles.mixedImageFrame,
            { width: resolvedImageLayout.width, height: resolvedImageLayout.height },
            pressed && styles.imagePressed,
          ]}>
          <Image
            source={{ uri: imageUri }}
            style={styles.imageFill}
            contentFit="contain"
            onError={() => setImageFailed(true)}
          />
        </GinitPressable>
      ) : (
        <View
          style={[
            styles.mixedImageFrame,
            { width: resolvedImageLayout.width, height: resolvedImageLayout.height },
          ]}>
          <Image
            source={{ uri: imageUri }}
            style={styles.imageFill}
            contentFit="contain"
            onError={() => setImageFailed(true)}
          />
        </View>
      )
    ) : !showImage && !hasText ? (
      <View style={[styles.heroFallback, { width: cardMaxWidth }]}>
        <GinitSymbolicIcon name="megaphone-outline" size={40} color={ACCENT} />
      </View>
    ) : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {imageOnly && resolvedImageLayout ? (
          <View
            style={[
              styles.cardImageOnly,
              { width: resolvedImageLayout.width, height: resolvedImageLayout.height },
            ]}>
            <View style={styles.imageOnlyFrame}>
              {imageLayoutLoading ? (
                <View style={styles.imageLoadingFill}>
                  <ActivityIndicator color="#fff" />
                </View>
              ) : hasLink ? (
                <GinitPressable
                  onPress={onPressImage}
                  accessibilityRole="button"
                  accessibilityLabel="공지 이미지, 탭하면 자세히 볼 수 있어요"
                  style={({ pressed }) => [styles.imageOnlyPressable, pressed && styles.imagePressed]}>
                  {imageElement}
                </GinitPressable>
              ) : (
                imageElement
              )}
            </View>
            <View style={styles.footerOverlay}>{footerRow}</View>
          </View>
        ) : (
          <View style={[styles.card, { width: cardMaxWidth, maxWidth: cardMaxWidth }]}>
            {imageLayoutLoading && showImage ? (
              <View
                style={[
                  styles.imageLoading,
                  resolvedImageLayout
                    ? { width: resolvedImageLayout.width, height: resolvedImageLayout.height }
                    : null,
                  styles.imageAlignCenter,
                ]}>
                <ActivityIndicator color={ACCENT} />
              </View>
            ) : mixedImageBlock ? (
              <View style={styles.imageAlignCenter}>{mixedImageBlock}</View>
            ) : null}

            {hasTitle ? <Text style={styles.title}>{title}</Text> : null}
            {hasBody ? (
              <Text style={styles.body} numberOfLines={6}>
                {body}
              </Text>
            ) : null}

            {footerRow}
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: ACCENT,
    overflow: 'hidden',
    paddingBottom: 4,
  },
  cardImageOnly: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  imageOnlyFrame: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  footerOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
  },
  imageOnlyPressable: {
    width: '100%',
    height: '100%',
  },
  imageFill: {
    width: '100%',
    height: '100%',
  },
  imageLoadingFill: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  imageLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GinitTheme.colors.bgAlt,
  },
  imagePressed: {
    opacity: 0.92,
  },
  heroFallback: {
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3E5F5',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#311B92',
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  imageAlignCenter: {
    alignSelf: 'center',
    width: '100%',
    alignItems: 'center',
  },
  mixedImageFrame: {
    overflow: 'hidden',
    backgroundColor: GinitTheme.colors.bgAlt,
  },
  body: {
    fontSize: 14,
    fontWeight: '500',
    color: GinitTheme.colors.textMuted,
    lineHeight: 20,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 12,
    gap: 4,
  },
  footerRowImageOnly: {
    paddingTop: 8,
    paddingBottom: 10,
    paddingHorizontal: 12,
  },
  footerTextBtn: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    flexShrink: 1,
  },
  footerSpacer: {
    flex: 1,
    minWidth: 8,
  },
  footerTextClose: {
    fontSize: 14,
    fontWeight: '600',
    color: GinitTheme.colors.text,
  },
  footerTextLink: {
    fontSize: 14,
    fontWeight: '700',
    color: ACCENT,
  },
  footerTextSnooze: {
    fontSize: 14,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    textAlign: 'right',
  },
  btnPressed: {
    opacity: 0.88,
  },
});
