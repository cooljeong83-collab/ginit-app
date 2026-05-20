import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { SupportScreenChrome } from '@/components/support/SupportScreenChrome';
import { supportScreenStyles as styles } from '@/components/support/supportScreenStyles';
import { GinitTheme } from '@/constants/ginit-theme';
import { formatSupportAnnouncementDate } from '@/src/features/support/support-announcements-api';
import { useAndroidOverlayHardwareBack } from '@/src/hooks/use-android-overlay-hardware-back';
import { useSupportAnnouncementDetailQuery } from '@/src/hooks/use-support-announcement-detail-query';
import { presentAppDialogAlert } from '@/src/lib/app-dialog-present';
import { safeRouterBack } from '@/src/lib/router-safe';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';

export default function SupportAnnouncementDetailScreen() {
  const router = useTransitionRouter();
  const handleHardwareBack = useCallback(() => safeRouterBack(router), [router]);
  useAndroidOverlayHardwareBack(handleHardwareBack);

  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = useMemo(() => {
    const raw = params.id;
    return (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
  }, [params.id]);

  const query = useSupportAnnouncementDetailQuery(id);

  useEffect(() => {
    if (!query.isError) return;
    const msg = query.error instanceof Error ? query.error.message : '공지를 불러오지 못했어요.';
    presentAppDialogAlert({ title: '불러오기 실패', body: msg });
  }, [query.isError, query.error]);

  const detail = query.data;

  return (
    <SupportScreenChrome title="공지사항" onBack={handleHardwareBack}>
      {query.isLoading || !detail ? (
        <View style={styles.centerLoad}>
          <ActivityIndicator color={GinitTheme.colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          {detail.imageUrl ? (
            <Image source={{ uri: detail.imageUrl }} style={styles.detailHero} contentFit="cover" />
          ) : null}
          <Text style={styles.detailTitle}>{detail.title}</Text>
          <Text style={styles.detailDate}>{formatSupportAnnouncementDate(detail.publishedAt)}</Text>
          <View style={styles.detailDivider} />
          <Text style={styles.detailBody}>{detail.body}</Text>
        </ScrollView>
      )}
    </SupportScreenChrome>
  );
}
