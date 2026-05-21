import { useCallback, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  View,
} from 'react-native';

import { NoticeInboxListRow } from '@/components/notices/NoticeInboxListRow';
import { NoticeInboxListSeparator } from '@/components/notices/NoticeInboxListSeparator';
import { SupportScreenChrome } from '@/components/support/SupportScreenChrome';
import { supportScreenStyles as styles } from '@/components/support/supportScreenStyles';
import { GinitTheme } from '@/constants/ginit-theme';
import { useAndroidOverlayHardwareBack } from '@/src/hooks/use-android-overlay-hardware-back';
import { useMarkNoticeInboxReadMutation } from '@/src/hooks/use-mark-notice-read-mutation';
import { useNoticeInboxInfiniteQuery } from '@/src/hooks/use-notice-inbox-infinite-query';
import { presentAppDialogAlert } from '@/src/lib/app-dialog-present';
import { safeRouterBack } from '@/src/lib/router-safe';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';

export default function NoticeInboxScreen() {
  const router = useTransitionRouter();
  const handleHardwareBack = useCallback(() => safeRouterBack(router), [router]);
  useAndroidOverlayHardwareBack(handleHardwareBack);

  const query = useNoticeInboxInfiniteQuery(true);
  const markRead = useMarkNoticeInboxReadMutation();
  const items = useMemo(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data?.pages],
  );

  const onRefresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  const onEndReached = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  }, [query]);

  const onPressItem = useCallback(
    (inboxId: string, noticeId: string, isRead: boolean) => {
      if (!isRead) {
        void markRead.mutate({ inboxId });
      }
      router.push(`/notices/${noticeId}` as never);
    },
    [markRead, router],
  );

  useEffect(() => {
    if (!query.isError) return;
    const msg = query.error instanceof Error ? query.error.message : '공지를 불러오지 못했어요.';
    presentAppDialogAlert({ title: '불러오기 실패', body: msg });
  }, [query.isError, query.error]);

  return (
    <SupportScreenChrome title="공지사항" onBack={handleHardwareBack}>
      {query.isLoading && items.length === 0 ? (
        <View style={styles.centerLoad}>
          <ActivityIndicator color={GinitTheme.colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.inboxId}
          style={{ flex: 1 }}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={NoticeInboxListSeparator}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={onRefresh}
              tintColor={GinitTheme.colors.primary}
              colors={[GinitTheme.colors.primary]}
            />
          }
          onEndReached={onEndReached}
          onEndReachedThreshold={0.35}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            !query.isLoading ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>등록된 공지가 없어요.</Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            query.isFetchingNextPage ? (
              <View style={styles.centerLoad}>
                <ActivityIndicator color={GinitTheme.colors.primary} />
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <NoticeInboxListRow
              item={item}
              onPress={() => onPressItem(item.inboxId, item.noticeId, item.isRead)}
            />
          )}
        />
      )}
    </SupportScreenChrome>
  );
}
