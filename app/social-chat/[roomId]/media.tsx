import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Timestamp } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { MeetingChatImageViewerZoomArea } from '@/components/chat/MeetingChatImageViewerZoomArea';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { saveRemoteImageUrlToLibrary, shareRemoteImageUrl } from '@/src/lib/chat-image-actions';
import {
  deleteSocialChatImageMessageBestEffort,
  parsePeerFromSocialRoomId,
  subscribeSocialChatMessages,
  type SocialChatMessage,
} from '@/src/lib/social-chat-rooms';
import type { UserProfile } from '@/src/lib/user-profile';
import { WITHDRAWN_NICKNAME, getUserProfilesForIds, isUserProfileWithdrawn } from '@/src/lib/user-profile';

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

export default function SocialChatMediaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const params = useLocalSearchParams<{ roomId: string | string[]; peerName?: string }>();
  const roomId = Array.isArray(params.roomId)
    ? (params.roomId[0] ?? '').trim()
    : typeof params.roomId === 'string'
      ? params.roomId.trim()
      : '';
  const peerName =
    typeof params.peerName === 'string' && params.peerName.trim()
      ? decodeURIComponent(params.peerName.trim())
      : '친구';
  const { userId } = useUserSession();

  const [profiles, setProfiles] = useState<Map<string, UserProfile>>(new Map());
  const [rows, setRows] = useState<SocialChatMessage[]>([]);
  const [busy, setBusy] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<SocialChatMessage | null>(null);
  const [viewerBusy, setViewerBusy] = useState(false);

  const peerId = useMemo(() => {
    const rid = roomId.trim();
    const me = userId?.trim() ?? '';
    if (!rid || !me) return '';
    return parsePeerFromSocialRoomId(rid, me) ?? '';
  }, [roomId, userId]);

  useEffect(() => {
    const ids = [userId?.trim() ?? '', peerId.trim()].filter(Boolean);
    if (ids.length === 0) return;
    void getUserProfilesForIds(ids).then(setProfiles);
  }, [userId, peerId]);

  const cell = useMemo(() => {
    const inner = winW - H_PAD * 2 - GRID_GAP * 2;
    return Math.max(96, Math.floor(inner / 3));
  }, [winW]);

  useEffect(() => {
    if (!roomId) return;
    setBusy(true);
    setListError(null);
    const unsub = subscribeSocialChatMessages(
      roomId,
      (list) => {
        setRows(list.filter((m) => m.kind === 'image' && Boolean(m.imageUrl?.trim())));
        setBusy(false);
        setRefreshing(false);
        setListError(null);
      },
      () => {
        setBusy(false);
        setRefreshing(false);
        setListError('사진을 불러오지 못했어요.');
        setRows([]);
      },
    );
    return unsub;
  }, [roomId]);

  const triggerRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 400);
  }, []);

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
          : (p?.nickname ?? peerName);
    return { when: formatSentAt(viewer.createdAt), who };
  }, [viewer, profiles, peerName]);

  const myId = useMemo(() => (userId?.trim() ? normalizeParticipantId(userId.trim()) : ''), [userId]);
  const canDelete = useMemo(() => {
    if (!viewer) return false;
    const sid = viewer.senderId?.trim() ? normalizeParticipantId(viewer.senderId.trim()) : '';
    return Boolean(myId && sid && sid === myId);
  }, [viewer, myId]);

  if (!roomId) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <Text style={styles.muted}>잘못된 주소예요.</Text>
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
          <Pressable onPress={triggerRefresh} style={styles.retryBtn} accessibilityRole="button">
            <Text style={styles.retryBtnText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : null}

      {busy ? (
        <View style={styles.center}>
          <ActivityIndicator color={GinitTheme.colors.primary} />
          <Text style={styles.muted}>불러오는 중…</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(it) => it.id}
          numColumns={3}
          columnWrapperStyle={{ gap: GRID_GAP }}
          contentContainerStyle={{
            paddingHorizontal: H_PAD,
            paddingTop: 10,
            paddingBottom: Math.max(insets.bottom, 12) + 16,
            gap: GRID_GAP,
          }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={triggerRefresh} />}
          renderItem={({ item }) => {
            const u = item.imageUrl?.trim() ?? '';
            return (
              <Pressable
                onPress={() => u && setViewer(item)}
                style={({ pressed }) => [styles.cell, { width: cell, height: cell }, pressed && { opacity: 0.88 }]}
                accessibilityRole="button"
                accessibilityLabel="사진 보기"
              >
                <View style={styles.cellInner}>
                  {u ? <Image source={{ uri: u }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <View style={styles.thumbFallback} />}
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={<Text style={styles.empty}>아직 사진이 없어요.</Text>}
        />
      )}

      <Modal visible={viewer != null} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <View style={styles.viewerOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => !viewerBusy && setViewer(null)} accessibilityRole="button" accessibilityLabel="닫기" />
            <View style={styles.viewerSheet} pointerEvents="box-none">
              <View style={[styles.viewerTopRow, { paddingTop: insets.top + 8 }]}>
                <Pressable onPress={() => setViewer(null)} hitSlop={10} disabled={viewerBusy} accessibilityRole="button" accessibilityLabel="닫기">
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
                        const rid = roomId.trim();
                        const msgId = viewer?.id?.trim() ?? '';
                        if (!u || !rid || !msgId) return;
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
                                  await deleteSocialChatImageMessageBestEffort(rid, msgId, u);
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
          </View>
        </GestureHandlerRootView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f2f4f7' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 10 },
  muted: { fontSize: 14, color: '#64748b', fontWeight: '600' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#f2f4f7',
  },
  headerTitle: { fontSize: 17, fontWeight: '900', color: '#0f172a', letterSpacing: -0.3 },
  errorBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(220, 38, 38, 0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(220, 38, 38, 0.16)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  errorText: { flex: 1, minWidth: 0, color: '#b91c1c', fontWeight: '700' },
  retryBtn: { paddingVertical: 8, paddingHorizontal: 12 },
  retryBtnText: { color: GinitTheme.colors.primary, fontWeight: '900' },
  empty: { marginTop: 48, textAlign: 'center', fontSize: 15, color: '#94a3b8', fontWeight: '700' },
  cell: { borderRadius: 12, overflow: 'hidden' },
  cellInner: { flex: 1, backgroundColor: '#fff', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(15, 23, 42, 0.06)' },
  thumbFallback: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.06)' },
  viewerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)' },
  viewerSheet: { flex: 1 },
  viewerTopRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  viewerMetaCol: { flex: 1, minWidth: 0 },
  viewerMetaName: { color: '#fff', fontSize: 14, fontWeight: '900' },
  viewerMetaTime: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700', marginTop: 2 },
  viewerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  viewerImageWrap: { flex: 1, paddingTop: 64 },
});

