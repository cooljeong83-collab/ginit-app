import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image as RNImage,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { noticeInboxDisplayStyles } from '@/components/notices/noticeInboxDisplay';
import { SupportScreenChrome } from '@/components/support/SupportScreenChrome';
import { supportScreenStyles as styles } from '@/components/support/supportScreenStyles';
import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitTheme } from '@/constants/ginit-theme';
import { formatNoticeDate } from '@/src/features/notices/notices-api';
import { navigateFromNoticeLink } from '@/src/features/notices/notice-link-navigation';
import { useAndroidOverlayHardwareBack } from '@/src/hooks/use-android-overlay-hardware-back';
import { useMarkNoticeInboxReadMutation } from '@/src/hooks/use-mark-notice-read-mutation';
import { useNoticeDetailQuery } from '@/src/hooks/use-notice-detail-query';
import { presentAppDialogAlert } from '@/src/lib/app-dialog-present';
import { safeRouterBack } from '@/src/lib/router-safe';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';

const ACCENT = '#673AB7';

export default function NoticeDetailScreen() {
  const router = useTransitionRouter();
  const handleHardwareBack = useCallback(() => safeRouterBack(router), [router]);
  useAndroidOverlayHardwareBack(handleHardwareBack);

  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = useMemo(() => {
    const raw = params.id;
    return (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
  }, [params.id]);

  const query = useNoticeDetailQuery(id);
  const markRead = useMarkNoticeInboxReadMutation();
  const detail = query.data;

  const imageUri = detail?.imageUrl?.trim() ?? '';
  const [imageAspect, setImageAspect] = useState<number | null>(null);

  useEffect(() => {
    if (!imageUri) {
      setImageAspect(null);
      return;
    }
    let alive = true;
    RNImage.getSize(
      imageUri,
      (iw, ih) => {
        if (!alive || iw <= 0 || ih <= 0) return;
        setImageAspect(iw / ih);
      },
      () => {
        if (!alive) return;
        setImageAspect(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [imageUri]);

  useEffect(() => {
    if (!detail || detail.isRead) return;
    const inboxId = detail.inboxId?.trim();
    if (inboxId) {
      void markRead.mutate({ inboxId });
    } else {
      void markRead.mutate({ noticeId: detail.id });
    }
  }, [detail?.id, detail?.isRead, detail?.inboxId, markRead]);

  useEffect(() => {
    if (!query.isError) return;
    const msg = query.error instanceof Error ? query.error.message : '공지를 불러오지 못했어요.';
    presentAppDialogAlert({ title: '불러오기 실패', body: msg });
  }, [query.isError, query.error]);

  const onOpenLink = useCallback(() => {
    if (!detail) return;
    navigateFromNoticeLink(router, { noticeId: detail.id, linkUrl: detail.linkUrl });
  }, [detail, router]);

  const imageOnly = Boolean(detail?.isImageOnly && imageUri);
  const dateLabel = detail ? formatNoticeDate(detail.createdAt) : '';
  const titleText = detail?.title.trim() ?? '';
  const bodyContent = detail?.content.trim() ?? '';
  const headerTitle = detail?.isImageOnly
    ? titleText || (bodyContent ? '' : '이미지 공지')
    : titleText;
  const showBody = Boolean(bodyContent);
  const showHeader = Boolean(dateLabel || headerTitle);

  return (
    <SupportScreenChrome title="공지사항" onBack={handleHardwareBack}>
      {query.isLoading || !detail ? (
        <View style={styles.centerLoad}>
          <ActivityIndicator color={GinitTheme.colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            imageOnly && localStyles.scrollContentImageOnly,
          ]}
          showsVerticalScrollIndicator={false}>
          {showHeader ? (
            <View style={noticeInboxDisplayStyles.headerBlock}>
              {dateLabel ? (
                <Text style={noticeInboxDisplayStyles.date}>{dateLabel}</Text>
              ) : null}
              {headerTitle ? (
                <Text style={noticeInboxDisplayStyles.headline}>{headerTitle}</Text>
              ) : null}
            </View>
          ) : null}

          {imageUri ? (
            <View style={localStyles.detailImageWrap}>
              <Image
                source={{ uri: imageUri }}
                style={[
                  localStyles.detailImage,
                  imageAspect != null ? { aspectRatio: imageAspect } : localStyles.detailImageLoading,
                ]}
                contentFit="contain"
              />
            </View>
          ) : null}

          {showBody ? (
            <>
              <View style={styles.detailDivider} />
              <Text style={[styles.detailBody, localStyles.detailBody]}>{bodyContent}</Text>
            </>
          ) : null}
          {detail.linkUrl ? (
            <GinitPressable
              onPress={onOpenLink}
              style={({ pressed }) => [
                localStyles.linkBtn,
                pressed && { opacity: 0.9 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="링크 열기">
              <Text style={localStyles.linkBtnText}>링크 열기</Text>
            </GinitPressable>
          ) : null}
        </ScrollView>
      )}
    </SupportScreenChrome>
  );
}

const localStyles = StyleSheet.create({
  scrollContentImageOnly: {
    flexGrow: 1,
  },
  detailImageWrap: {
    width: '100%',
    marginBottom: 16,
  },
  detailImage: {
    width: '100%',
    backgroundColor: GinitTheme.colors.bgAlt,
    borderRadius: 8,
  },
  detailImageLoading: {
    width: '100%',
    aspectRatio: 3 / 4,
    minHeight: 120,
  },
  detailBody: {
    fontWeight: '400',
  },
  linkBtn: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: ACCENT,
    backgroundColor: '#F3E5F5',
    alignItems: 'center',
  },
  linkBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: ACCENT,
  },
});
