import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Image as RNImage,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import type { ActiveNoticeItem } from '@/src/features/notices/notices-api';

const ACCENT = '#673AB7';
const AUTO_ADVANCE_MS = 4500;
const BACKDROP_PADDING = 24;
const FOOTER_BLOCK_HEIGHT = 52;
const PAGE_DOTS_HEIGHT = 14;

type Props = {
  notices: ActiveNoticeItem[];
  visible: boolean;
  onClose: (notice: ActiveNoticeItem) => void;
  onConfirm: (notice: ActiveNoticeItem) => void;
  onSnoozeToday: (notice: ActiveNoticeItem) => void;
};

type ImageLayout = { width: number; height: number };

type SlideBodyProps = {
  notice: ActiveNoticeItem;
  cardMaxWidth: number;
  imageMaxHeight: number;
  onImagePress?: () => void;
};

type FooterProps = {
  notice: ActiveNoticeItem;
  imageOnly: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onSnoozeToday: () => void;
  style?: StyleProp<ViewStyle>;
};

/** 카드(팝업) 안에서 비율 유지하며 가능한 한 크게 맞춤 — 상한만 적용, 작은 이미지는 확대 */
function fitImageLayout(iw: number, ih: number, maxW: number, maxH: number): ImageLayout {
  if (iw <= 0 || ih <= 0) return { width: maxW, height: Math.round(maxW * 0.6) };
  const scale = Math.min(maxW / iw, maxH / ih);
  return {
    width: Math.max(1, Math.round(iw * scale)),
    height: Math.max(1, Math.round(ih * scale)),
  };
}

function NoticePopupFooter({
  notice,
  imageOnly,
  onClose,
  onConfirm,
  onSnoozeToday,
  style,
}: FooterProps) {
  const hasLink = Boolean(notice.linkUrl?.trim());

  return (
    <View style={[styles.footerRow, imageOnly && styles.footerRowImageOnly, style]}>
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
          onPress={onConfirm}
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
}

function NoticePopupSlideBody({ notice, cardMaxWidth, imageMaxHeight, onImagePress }: SlideBodyProps) {
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

  const onPressImage = useCallback(() => {
    if (hasLink) onImagePress?.();
  }, [hasLink, onImagePress]);

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
    ) : !showImage && !hasTitle && !hasBody ? (
      <View style={[styles.heroFallback, { width: cardMaxWidth }]}>
        <GinitSymbolicIcon name="megaphone-outline" size={40} color={ACCENT} />
      </View>
    ) : null;

  if (imageOnly && resolvedImageLayout) {
    return (
      <View
        style={[
          styles.cardImageOnly,
          { width: resolvedImageLayout.width, height: resolvedImageLayout.height },
        ]}>
        {imageLayoutLoading ? (
          <View style={styles.imageLoadingFill}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : hasLink && onImagePress ? (
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
    );
  }

  return (
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
    </View>
  );
}

function isImageOnlyNotice(notice: ActiveNoticeItem): boolean {
  const imageUri = notice.imageUrl?.trim() ?? '';
  return notice.isImageOnly && imageUri.length > 0;
}

export function NoticePopupModal({ notices, visible, onClose, onConfirm, onSnoozeToday }: Props) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const noticeIdsKey = notices.map((n) => n.id).join(',');
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  const autoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const userDraggingRef = useRef(false);
  const layoutReadyRef = useRef(false);

  const showCarousel = notices.length > 1;
  const pageWidth = Math.max(1, windowWidth - BACKDROP_PADDING * 2);
  const cardMaxWidth = Math.min(pageWidth, 400);
  const imageOnlyCardMaxWidth = pageWidth;

  const chromeHeight =
    FOOTER_BLOCK_HEIGHT + (showCarousel ? PAGE_DOTS_HEIGHT + 6 : 0) + BACKDROP_PADDING * 2;
  const imageMaxHeight = Math.max(160, Math.round(windowHeight - chromeHeight));

  const activeNotice = notices[activeIndex] ?? notices[0] ?? null;
  const activeImageOnly = activeNotice ? isImageOnlyNotice(activeNotice) : false;

  activeIndexRef.current = activeIndex;

  const clearAutoAdvance = useCallback(() => {
    if (autoTimerRef.current) {
      clearInterval(autoTimerRef.current);
      autoTimerRef.current = null;
    }
  }, []);

  const scrollToPage = useCallback(
    (index: number, animated: boolean) => {
      if (index < 0 || index >= notices.length) return;
      scrollRef.current?.scrollTo({ x: pageWidth * index, y: 0, animated });
      setActiveIndex(index);
      activeIndexRef.current = index;
    },
    [notices.length, pageWidth],
  );

  const scheduleAutoAdvance = useCallback(() => {
    clearAutoAdvance();
    if (!visible || !showCarousel || !layoutReadyRef.current) return;
    autoTimerRef.current = setInterval(() => {
      if (userDraggingRef.current) return;
      const next = (activeIndexRef.current + 1) % notices.length;
      scrollToPage(next, true);
    }, AUTO_ADVANCE_MS);
  }, [clearAutoAdvance, visible, showCarousel, notices.length, scrollToPage]);

  useEffect(() => {
    layoutReadyRef.current = false;
    if (!visible) {
      clearAutoAdvance();
      return;
    }
    setActiveIndex(0);
    activeIndexRef.current = 0;
    if (showCarousel) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ x: 0, y: 0, animated: false });
        layoutReadyRef.current = true;
        scheduleAutoAdvance();
      });
    } else {
      layoutReadyRef.current = true;
    }
    return clearAutoAdvance;
  }, [visible, showCarousel, noticeIdsKey, clearAutoAdvance, scheduleAutoAdvance]);

  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const idx = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
      const clamped = Math.max(0, Math.min(idx, notices.length - 1));
      setActiveIndex(clamped);
      activeIndexRef.current = clamped;
      userDraggingRef.current = false;
      scheduleAutoAdvance();
    },
    [notices.length, pageWidth, scheduleAutoAdvance],
  );

  const onScrollBeginDrag = useCallback(() => {
    userDraggingRef.current = true;
    clearAutoAdvance();
  }, [clearAutoAdvance]);

  const handleModalClose = useCallback(() => {
    if (!activeNotice) return;
    onClose(activeNotice);
  }, [activeNotice, onClose]);

  if (!activeNotice) return null;

  const singleImageOnlyPopup = !showCarousel && activeImageOnly;

  const footer = (
    <NoticePopupFooter
      notice={activeNotice}
      imageOnly={activeImageOnly}
      onClose={() => onClose(activeNotice)}
      onConfirm={() => onConfirm(activeNotice)}
      onSnoozeToday={() => onSnoozeToday(activeNotice)}
      style={singleImageOnlyPopup ? styles.footerBelowSingleImage : undefined}
    />
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleModalClose}>
      <View style={styles.backdrop}>
        <View style={[styles.popupColumn, { maxWidth: pageWidth }]}>
          {showCarousel ? (
            <>
              <ScrollView
                ref={scrollRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                bounces={notices.length > 1}
                style={{ width: pageWidth }}
                contentContainerStyle={styles.carouselContent}
                onScrollBeginDrag={onScrollBeginDrag}
                onMomentumScrollEnd={onScrollEnd}
                onScrollEndDrag={onScrollEnd}
                scrollEventThrottle={16}>
                {notices.map((notice) => {
                  const slideImageOnly = isImageOnlyNotice(notice);
                  const slideCardW = slideImageOnly ? imageOnlyCardMaxWidth : cardMaxWidth;
                  return (
                    <View key={notice.id} style={[styles.page, { width: pageWidth }]}>
                      <NoticePopupSlideBody
                        notice={notice}
                        cardMaxWidth={slideCardW}
                        imageMaxHeight={imageMaxHeight}
                        onImagePress={
                          notice.linkUrl?.trim() ? () => onConfirm(notice) : undefined
                        }
                      />
                    </View>
                  );
                })}
              </ScrollView>

              <View style={styles.pageDots} pointerEvents="none" accessibilityElementsHidden>
                {notices.map((notice, i) => (
                  <View
                    key={notice.id}
                    style={[styles.pageDot, i === activeIndex && styles.pageDotActive]}
                  />
                ))}
              </View>

              {footer}
            </>
          ) : (
            <>
              <NoticePopupSlideBody
                notice={activeNotice}
                cardMaxWidth={
                  isImageOnlyNotice(activeNotice) ? imageOnlyCardMaxWidth : cardMaxWidth
                }
                imageMaxHeight={imageMaxHeight}
                onImagePress={
                  activeNotice.linkUrl?.trim() ? () => onConfirm(activeNotice) : undefined
                }
              />
              {footer}
            </>
          )}
        </View>
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
    padding: BACKDROP_PADDING,
  },
  popupColumn: {
    width: '100%',
    alignItems: 'center',
    gap: 0,
  },
  carouselContent: {
    alignItems: 'center',
  },
  page: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    height: PAGE_DOTS_HEIGHT,
    marginTop: 0,
    marginBottom: 0,
  },
  pageDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
  },
  pageDotActive: {
    width: 16,
    backgroundColor: '#fff',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: ACCENT,
    overflow: 'hidden',
  },
  cardImageOnly: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
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
    flex: 1,
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
    paddingBottom: 4,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 4,
    paddingTop: 10,
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderRadius: 12,
  },
  footerRowImageOnly: {
    paddingTop: 8,
    paddingBottom: 8,
  },
  footerBelowSingleImage: {
    marginTop: 2,
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
