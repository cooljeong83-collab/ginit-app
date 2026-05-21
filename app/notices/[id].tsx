import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

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

  return (
    <SupportScreenChrome title="공지" onBack={handleHardwareBack}>
      {query.isLoading || !detail ? (
        <View style={styles.centerLoad}>
          <ActivityIndicator color={GinitTheme.colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {detail.imageUrl ? (
            <Image source={{ uri: detail.imageUrl }} style={styles.detailHero} contentFit="cover" />
          ) : null}
          <Text style={styles.detailTitle}>{detail.title}</Text>
          <Text style={styles.detailDate}>{formatNoticeDate(detail.createdAt)}</Text>
          <View style={styles.detailDivider} />
          <Text style={styles.detailBody}>{detail.content}</Text>
          {detail.linkUrl ? (
            <GinitPressable
              onPress={onOpenLink}
              style={({ pressed }) => [
                {
                  marginTop: 20,
                  paddingVertical: 12,
                  paddingHorizontal: 16,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: ACCENT,
                  backgroundColor: '#F3E5F5',
                  alignItems: 'center',
                },
                pressed && { opacity: 0.9 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="링크 열기">
              <Text style={{ fontSize: 15, fontWeight: '700', color: ACCENT }}>링크 열기</Text>
            </GinitPressable>
          ) : null}
        </ScrollView>
      )}
    </SupportScreenChrome>
  );
}
