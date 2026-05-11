import type { ReactNode } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { FlatList, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';

export type MeetingDetailTopNoticeSlide = {
  key: string;
  element: ReactNode;
};

/**
 * 모임 채팅 `announcementBar` / `announcementInner`와 동일한 확정 공지 스타일(Blur + 메가폰 16 + 본문 13/600).
 * @see app/meeting-chat/[meetingId]/index.tsx
 */
export function MeetingDetailStaticNoticeRow({
  text,
  titleLeft,
  timeRight,
  accessibilityLabel: accessibilityLabelProp,
  slideTrackFullBleed,
}: {
  text?: string;
  titleLeft?: string;
  timeRight?: string;
  accessibilityLabel?: string;
  slideTrackFullBleed?: boolean;
}) {
  const useSplit =
    typeof titleLeft === 'string' &&
    typeof timeRight === 'string' &&
    (titleLeft.trim().length > 0 || timeRight.trim().length > 0);
  const accessibilityLabel =
    accessibilityLabelProp ??
    (useSplit ? `${titleLeft?.trim() ?? ''} ${timeRight?.trim() ?? ''}`.trim() : (text ?? ''));
  return (
    <View
      style={[staticStyles.pillShell, slideTrackFullBleed && staticStyles.pillShellFullBleed]}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}>
      <View style={staticStyles.pillRow}>
        <GinitSymbolicIcon name="megaphone-outline" size={16} color={GinitTheme.colors.deepPurple} />
        {useSplit ? (
          <>
            <Text style={staticStyles.text} numberOfLines={1} ellipsizeMode="tail">
              {(titleLeft ?? '').trim() || '모임'}
            </Text>
            <Text style={staticStyles.timeRight} numberOfLines={1}>
              {(timeRight ?? '').trim()}
            </Text>
          </>
        ) : (
          <>
            <Text style={staticStyles.text} numberOfLines={1} ellipsizeMode="tail">
              {text ?? ''}
            </Text>
            <View style={staticStyles.trailingSpacer} />
          </>
        )}
      </View>
    </View>
  );
}

const staticStyles = StyleSheet.create({
  /** 한 덩어리 캡슐 — 연한 퍼플 표면(채팅 공지 바와 톤 맞춤) */
  pillShell: {
    marginHorizontal: 12,
    marginVertical: 6,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: GinitTheme.colors.noticeSurface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  text: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.text,
  },
  timeRight: {
    flexShrink: 0,
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.text,
  },
  trailingSpacer: { width: 16 },
  pillShellFullBleed: {
    marginHorizontal: 0,
    marginVertical: 0,
    width: '100%',
    alignSelf: 'stretch',
    borderRadius: 0,
  },
});

type Props = {
  slides: MeetingDetailTopNoticeSlide[];
  /** true면 트랙 상단 헤어라인 생략(홈: 탭·탐색/내모임과 트랙 사이 이음) */
  hideTopTrackDivider?: boolean;
};

/** 다중 공지일 때 자동 슬라이드 간격(ms) */
const NOTICE_AUTO_ADVANCE_MS = 5000;

/**
 * 모임 상단 공지(정산·장소 인증·확정 안내 등)를 가로 스와이프합니다.
 * 슬라이드가 2개 이상이면 `NOTICE_AUTO_ADVANCE_MS` 간격으로 자동 순환합니다.
 * 슬라이드가 1개면 스크롤 없음.
 */
export function MeetingDetailTopNoticesPager({ slides, hideTopTrackDivider }: Props) {
  const isFocused = useIsFocused();
  const pages = useMemo(() => slides.filter((s) => s.element != null), [slides]);
  const slideKeysSig = useMemo(() => pages.map((p) => p.key).join('|'), [pages]);
  /** 실제 트랙 너비만 사용(전체 화면으로 덮어쓰면 padding 헤더에서 페이징·슬라이드 폭이 어긋져 글씨가 안 보일 수 있음). */
  const [pageW, setPageW] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const listRef = useRef<FlatList<MeetingDetailTopNoticeSlide>>(null);
  const pageWRef = useRef(0);
  const pagesLenRef = useRef(0);
  const activeIndexRef = useRef(0);
  const mountedRef = useRef(true);

  const onPagerLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0) setPageW(w);
  }, []);

  useLayoutEffect(() => {
    pageWRef.current = pageW;
  }, [pageW]);

  useEffect(() => {
    pagesLenRef.current = pages.length;
  }, [pages.length]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** 자식 수·오프셋 불일치(Android paging) 방지: 슬라이드/폭이 바뀌면 페인트 전에 0페이지로 고정 */
  useLayoutEffect(() => {
    if (!mountedRef.current) return;
    if (pages.length <= 1 || pageW <= 0) return;
    activeIndexRef.current = 0;
    if (Platform.OS === 'android') {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    } else {
      scrollRef.current?.scrollTo({ x: 0, animated: false });
    }
  }, [slideKeysSig, pageW, pages.length]);

  useEffect(() => {
    if (!isFocused || pages.length <= 1 || pageW <= 0) return;
    const id = setInterval(() => {
      if (!mountedRef.current) return;
      const len = pagesLenRef.current;
      const w = pageWRef.current;
      if (len <= 1 || w <= 0) return;
      const next = (activeIndexRef.current + 1) % len;
      activeIndexRef.current = next;
      if (Platform.OS === 'android') {
        listRef.current?.scrollToOffset({ offset: next * w, animated: true });
      } else {
        scrollRef.current?.scrollTo({ x: next * w, animated: true });
      }
    }, NOTICE_AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [isFocused, slideKeysSig, pageW, pages.length]);

  const onMomentumScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const w = pageWRef.current;
    const len = pagesLenRef.current;
    if (w <= 0 || len <= 0) return;
    const x = e.nativeEvent.contentOffset.x;
    const idx = Math.round(x / w);
    activeIndexRef.current = Math.max(0, Math.min(len - 1, idx));
  }, []);

  const getItemLayout = useCallback(
    (_data: ArrayLike<MeetingDetailTopNoticeSlide> | null | undefined, index: number) => {
      const w = pageWRef.current;
      return { length: w, offset: w * index, index };
    },
    [],
  );

  if (pages.length === 0) return null;

  const pagerMountKey = `${slideKeysSig}#${pages.length}`;

  return (
    <View
      key={pagerMountKey}
      style={[styles.outer, hideTopTrackDivider && styles.outerNoTopDivider]}
      onLayout={onPagerLayout}
      collapsable={false}>
      {pages.length === 1 ? (
        <View style={styles.singleSlideHost}>{pages[0].element}</View>
      ) : pageW <= 0 ? (
        /** `pagingEnabled` + 자식 0개는 Android에서 index OOB 크래시 유발 가능 — 폭 확정 후에만 스크롤러 마운트 */
        <View style={styles.pagerMeasurePlaceholder} collapsable={false} />
      ) : Platform.OS === 'android' ? (
        <FlatList
          ref={listRef}
          data={pages}
          keyExtractor={(p) => p.key}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          removeClippedSubviews={false}
          initialNumToRender={pages.length}
          maxToRenderPerBatch={pages.length}
          windowSize={Math.min(21, pages.length + 2)}
          getItemLayout={getItemLayout}
          renderItem={({ item }) => (
            <View style={{ width: pageW, alignItems: 'stretch' }} collapsable={false}>
              {item.element}
            </View>
          )}
          onMomentumScrollEnd={onMomentumScrollEnd}
        />
      ) : (
        <ScrollView
          key={slideKeysSig}
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          decelerationRate="fast"
          onMomentumScrollEnd={onMomentumScrollEnd}>
          {pages.map((p) => (
            <View key={p.key} style={{ width: pageW, alignItems: 'stretch' }}>
              {p.element}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  /** 슬라이드 트랙: 연한 퍼플·캡슐 라운딩. 상단 헤어라인은 `hideTopTrackDivider`로 끌 수 있음 */
  outer: {
    borderRadius: GinitTheme.radius.pill,
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(15, 23, 42, 0.08)',
    backgroundColor: GinitTheme.colors.noticeSurface,
  },
  outerNoTopDivider: {
    borderTopWidth: 0,
    borderTopColor: 'transparent',
  },
  singleSlideHost: {
    width: '100%',
    alignItems: 'stretch',
  },
  pagerMeasurePlaceholder: {
    width: '100%',
    minHeight: 1,
  },
});
