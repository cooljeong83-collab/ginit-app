import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { DocumentSnapshot, Timestamp } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Modal,
    Platform,
    Pressable,
    RefreshControl,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { MeetingChatImageViewerZoomArea } from '@/components/chat/MeetingChatImageViewerZoomArea';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { saveRemoteImageUrlToLibrary, shareRemoteImageUrl } from '@/src/lib/chat-image-actions';
import { isUserJoinedMeeting } from '@/src/lib/joined-meetings';
import {
    deleteMeetingChatImageMessageBestEffort,
    fetchMeetingChatImagesPage,
    type MeetingChatMessage,
} from '@/src/lib/meeting-chat';
import type { Meeting } from '@/src/lib/meetings';
import { subscribeMeetingById } from '@/src/lib/meetings';
import type { UserProfile } from '@/src/lib/user-profile';
import { getUserProfilesForIds, isUserProfileWithdrawn, WITHDRAWN_NICKNAME } from '@/src/lib/user-profile';

function profileForSender(map: Map<string, UserProfile>, senderId: string | null): UserProfile | undefined {
  if (!senderId?.trim()) return undefined;
  const n = normalizeParticipantId(senderId);
  const hit = map.get(senderId) ?? map.get(n);
  if (hit) return hit;
  for (const [k, v] of map) {
    if (normalizeParticipantId(k) === n) return v;
  }
  return undefined;
}

function uniqueParticipantPids(m: Meeting | null | undefined): string[] {
  if (!m) return [];
  const ids = [...(m.participantIds ?? []), ...(m.createdBy?.trim() ? [m.createdBy] : [])];
  return [...new Set(ids.map((x) => normalizeParticipantId(String(x)) ?? String(x).trim()).filter(Boolean))];
}

function formatSentAt(ts: Timestamp | null | undefined): string {
  if (!ts || typeof ts.toDate !== 'function') return '';
  try {
    return ts.toDate().toLocaleString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

const GRID_GAP = 4;
const H_PAD = 12;

export default function MeetingChatMediaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const params = useLocalSearchParams<{ meetingId: string | string[] }>();
  const meetingId = Array.isArray(params.meetingId)
    ? (params.meetingId[0] ?? '').trim()
    : typeof params.meetingId === 'string'
      ? params.meetingId.trim()
      : '';
  const { userId } = useUserSession();

  const [meeting, setMeeting] = useState<Meeting | null | undefined>(undefined);
  const [profiles, setProfiles] = useState<Map<string, UserProfile>>(new Map());
  const [rows, setRows] = useState<MeetingChatMessage[]>([]);
  const [busy, setBusy] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [viewer, setViewer] = useState<MeetingChatMessage | null>(null);
  const [viewerBusy, setViewerBusy] = useState(false);

  const cursorRef = useRef<DocumentSnapshot | null>(null);
  const loadSeq = useRef(0);

  const allowed = useMemo(() => {
    if (meeting === undefined) return null;
    if (!meeting) return false;
    return isUserJoinedMeeting(meeting, userId);
  }, [meeting, userId]);

  useEffect(() => {
    if (!meetingId) {
      setMeeting(null);
      return;
    }
    return subscribeMeetingById(
      meetingId,
      (m) => setMeeting(m),
      () => {},
    );
  }, [meetingId]);

  useEffect(() => {
    if (!meeting || allowed !== true) return;
    const ids = uniqueParticipantPids(meeting);
    void getUserProfilesForIds(ids).then(setProfiles);
  }, [meeting, allowed]);

  const cell = useMemo(() => {
    const inner = winW - H_PAD * 2 - GRID_GAP * 2;
    return Math.max(96, Math.floor(inner / 3));
  }, [winW]);

  const loadFirstPage = useCallback(
    async (opts?: { isRefresh?: boolean }) => {
      if (!meetingId) return;
      const seq = ++loadSeq.current;
      if (opts?.isRefresh) setRefreshing(true);
      else setBusy(true);
      setListError(null);
      cursorRef.current = null;
      try {
        const { images, nextCursor, hasMore: more } = await fetchMeetingChatImagesPage(meetingId, null);
        if (seq !== loadSeq.current) return;
        setRows(images);
        cursorRef.current = nextCursor;
        setHasMore(more);
      } catch {
        if (seq !== loadSeq.current) return;
        setListError('사진을 불러오지 못했어요.');
        setRows([]);
        setHasMore(false);
      } finally {
        if (seq !== loadSeq.current) return;
        if (opts?.isRefresh) setRefreshing(false);
        else setBusy(false);
      }
    },
    [meetingId],
  );

  useEffect(() => {
    if (allowed !== true || !meetingId) return;
    void loadFirstPage();
  }, [allowed, meetingId, loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!meetingId || !hasMore || loadingMore || busy) return;
    const cur = cursorRef.current;
    if (!cur) return;
    setLoadingMore(true);
    const seq = loadSeq.current;
    try {
      const { images, nextCursor, hasMore: more } = await fetchMeetingChatImagesPage(meetingId, cur);
      if (seq !== loadSeq.current) return;
      setRows((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const merged = [...prev];
        for (const m of images) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            merged.push(m);
          }
        }
        return merged;
      });
      cursorRef.current = nextCursor;
      setHasMore(more);
    } catch {
      /* 한 페이지 실패는 조용히 종료 */
    } finally {
      if (seq === loadSeq.current) setLoadingMore(false);
    }
  }, [meetingId, hasMore, loadingMore, busy]);

  const onBack = useCallback(() => {
    router.back();
  }, [router]);

  const viewerMeta = useMemo(() => {
    if (!viewer) return { when: '', who: '' };
    const sid = viewer.senderId?.trim() ? normalizeParticipantId(viewer.senderId.trim()) : '';
    const p = sid ? profileForSender(profiles, viewer.senderId) : undefined;
    const who =
      viewer.kind === 'system'
        ? '알림'
        : isUserProfileWithdrawn(p)
          ? WITHDRAWN_NICKNAME
          : (p?.nickname ?? '회원');
    return { when: formatSentAt(viewer.createdAt), who };
  }, [viewer, profiles]);

  const myId = useMemo(() => (userId?.trim() ? normalizeParticipantId(userId.trim()) : ''), [userId]);
  const canDelete = useMemo(() => {
    if (!viewer) return false;
    const sid = viewer.senderId?.trim() ? normalizeParticipantId(viewer.senderId.trim()) : '';
    return Boolean(myId && sid && sid === myId);
  }, [viewer, myId]);

  if (!meetingId) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <Text style={styles.muted}>잘못된 주소예요.</Text>
      </SafeAreaView>
    );
  }

  if (meeting === undefined) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <ActivityIndicator color={GinitTheme.colors.primary} />
      </SafeAreaView>
    );
  }

  if (!meeting || allowed !== true) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <Text style={styles.muted}>참여 중인 모임만 볼 수 있어요.</Text>
        <Pressable onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>돌아가기</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const uri = viewer?.imageUrl?.trim() ?? '';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="뒤로">
          <Ionicons name="chevron-back" size={28} color={GinitTheme.colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>사진</Text>
        <View style={{ width: 28 }} />
      </View>

      {listError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{listError}</Text>
          <Pressable onPress={() => void loadFirstPage()} style={styles.retryBtn} accessibilityRole="button">
            <Text style={styles.retryBtnText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : null}

      {busy && rows.length === 0 ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={GinitTheme.colors.primary} />
          <Text style={styles.muted}>불러오는 중…</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          numColumns={3}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={[styles.gridContent, rows.length === 0 && styles.gridContentEmpty]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadFirstPage({ isRefresh: true })}
              tintColor={GinitTheme.colors.primary}
              colors={[GinitTheme.colors.primary]}
            />
          }
          onEndReached={() => {
            void loadMore();
          }}
          onEndReachedThreshold={0.35}
          ListEmptyComponent={
            !busy ? (
              <Text style={styles.emptyText}>이 채팅방에서 주고받은 사진이 아직 없어요.</Text>
            ) : null
          }
          ListFooterComponent={
            loadingMore && hasMore ? (
              <View style={styles.footerBusy}>
                <ActivityIndicator color={GinitTheme.colors.primary} />
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const u = item.imageUrl?.trim() ?? '';
            if (!u) return <View style={{ width: cell, height: 0 }} />;
            return (
              <Pressable
                onPress={() => setViewer(item)}
                style={[styles.thumbCell, { width: cell, height: cell }]}
                accessibilityRole="button"
                accessibilityLabel="사진 크게 보기">
                <Image source={{ uri: u }} style={styles.thumbImg} contentFit="cover" />
              </Pressable>
            );
          }}
        />
      )}

      <Modal visible={viewer !== null} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <GestureHandlerRootView style={styles.viewerRoot}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => !viewerBusy && setViewer(null)}
            pointerEvents="none"
            accessibilityRole="button"
            accessibilityLabel="닫기"
          />
          <View style={styles.viewerSheet} pointerEvents="box-none">
            <View style={[styles.viewerTopRow, { paddingTop: insets.top + 8 }]}>
              <Pressable
                onPress={() => setViewer(null)}
                hitSlop={10}
                disabled={viewerBusy}
                accessibilityRole="button"
                accessibilityLabel="닫기">
                <Ionicons name="close" size={26} color="#fff" />
              </Pressable>
              <View style={styles.viewerMetaCol} pointerEvents="none">
                <Text style={styles.viewerMetaName} numberOfLines={1}>
                  {viewerMeta.who}
                </Text>
                {viewerMeta.when ? (
                  <Text style={styles.viewerMetaTime} numberOfLines={1}>
                    {viewerMeta.when}
                  </Text>
                ) : null}
              </View>
              <View style={styles.viewerActions}>
                <Pressable
                  onPress={() => {
                    const u = viewer?.imageUrl?.trim() ?? '';
                    if (!u) return;
                    void (async () => {
                      setViewerBusy(true);
                      try {
                        await shareRemoteImageUrl(u);
                      } catch (e) {
                        Alert.alert('공유 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
                      } finally {
                        setViewerBusy(false);
                      }
                    })();
                  }}
                  hitSlop={10}
                  disabled={viewerBusy}
                  accessibilityRole="button"
                  accessibilityLabel="공유">
                  <Ionicons name="share-outline" size={24} color="#fff" />
                </Pressable>
                <Pressable
                  onPress={() => {
                    const u = viewer?.imageUrl?.trim() ?? '';
                    if (!u) return;
                    void (async () => {
                      setViewerBusy(true);
                      try {
                        await saveRemoteImageUrlToLibrary(u);
                      } catch (e) {
                        Alert.alert('저장 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
                      } finally {
                        setViewerBusy(false);
                      }
                    })();
                  }}
                  hitSlop={10}
                  disabled={viewerBusy}
                  accessibilityRole="button"
                  accessibilityLabel="저장">
                  <Ionicons name="download-outline" size={24} color="#fff" />
                </Pressable>
                {canDelete ? (
                  <Pressable
                    onPress={() => {
                      const u = viewer?.imageUrl?.trim() ?? '';
                      const mid = meetingId.trim();
                      const msgId = viewer?.id.trim() ?? '';
                      if (!u || !mid || !msgId) return;
                      if (viewerBusy) return;
                      Alert.alert('사진 삭제', '이 사진을 채팅방에서 삭제할까요?', [
                        { text: '취소', style: 'cancel' },
                        {
                          text: '삭제',
                          style: 'destructive',
                          onPress: () => {
                            void (async () => {
                              setViewerBusy(true);
                              try {
                                await deleteMeetingChatImageMessageBestEffort(mid, msgId, u);
                                setViewer(null);
                              } catch (e) {
                                Alert.alert('삭제 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
                              } finally {
                                setViewerBusy(false);
                              }
                            })();
                          },
                        },
                      ]);
                    }}
                    hitSlop={10}
                    disabled={viewerBusy}
                    accessibilityRole="button"
                    accessibilityLabel="삭제">
                    <Ionicons name="trash-outline" size={24} color="#fff" />
                  </Pressable>
                ) : null}
              </View>
            </View>
            {uri ? (
              <View style={styles.viewerImageWrap}>
                <MeetingChatImageViewerZoomArea uri={uri} />
              </View>
            ) : null}
          </View>
        </GestureHandlerRootView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f2f4f7' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  centerFill: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 },
  muted: { fontSize: 14, color: '#64748b', fontWeight: '600' },
  backBtn: { marginTop: 12, paddingVertical: 8, paddingHorizontal: 16 },
  backBtnText: { fontSize: 15, fontWeight: '600', color: GinitTheme.colors.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#f2f4f7',
  },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#0f172a', letterSpacing: -0.3 },
  errorBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#fef2f2',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(220, 38, 38, 0.25)',
  },
  errorText: { fontSize: 14, fontWeight: '600', color: '#b91c1c' },
  retryBtn: { marginTop: 8, alignSelf: 'flex-start' },
  retryBtnText: { fontSize: 14, fontWeight: '600', color: GinitTheme.colors.primary },
  gridContent: {
    paddingHorizontal: H_PAD,
    paddingTop: 8,
    paddingBottom: 24,
  },
  gridContentEmpty: { flexGrow: 1, justifyContent: 'center' },
  gridRow: {
    gap: GRID_GAP,
    marginBottom: GRID_GAP,
    justifyContent: 'flex-start',
  },
  thumbCell: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
  },
  thumbImg: { width: '100%', height: '100%' },
  emptyText: {
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
    color: '#64748b',
    paddingHorizontal: 24,
  },
  footerBusy: { paddingVertical: 20, alignItems: 'center' },
  viewerRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
  },
  viewerSheet: {
    flex: 1,
    paddingBottom: Platform.OS === 'ios' ? 12 : 8,
  },
  viewerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
  },
  viewerMetaCol: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8,
    justifyContent: 'center',
    minWidth: 0,
  },
  viewerMetaName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  viewerMetaTime: {
    marginTop: 2,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    fontWeight: '500',
  },
  viewerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  viewerImageWrap: {
    flex: 1,
    minHeight: 0,
    width: '100%',
  },
});
