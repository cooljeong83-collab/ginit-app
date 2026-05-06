import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenShell } from '@/components/ui';
import { GinitSymbolicIcon, type SymbolicIconName } from '@/components/ui/GinitSymbolicIcon';
import { showTransientBottomMessage } from '@/components/ui/TransientBottomMessage';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import {
  friendDisplayName,
  friendPeerMemo,
  loadFavoritePeerKeys,
  loadFriendDisplayAliases,
  loadFriendPeerMemos,
  saveFavoritePeerKeys,
  saveFriendDisplayAlias,
  saveFriendPeerMemo,
  toggleFavoritePeer,
} from '@/src/lib/friend-device-meta';
import { fetchFriendRelationStatus, removeAcceptedFriend } from '@/src/lib/friends';
import {
  friendPeerStorageKey,
  loadBlockedPeerIds,
  loadHiddenPeerIds,
  saveBlockedPeerIds,
  saveHiddenPeerIds,
} from '@/src/lib/friends-privacy-local';
import { blockPeerServerSynced } from '@/src/lib/user-blocks';
import { safeRouterBack } from '@/src/lib/router-safe';
import { getUserProfile, isUserProfileWithdrawn, WITHDRAWN_NICKNAME, type UserProfile } from '@/src/lib/user-profile';

const MEMO_MAX_LEN = 2000;
const DISPLAY_NAME_MAX_LEN = 40;

/** `app/profile/settings.tsx` 스위치 트랙과 동일 */
const meetingCreateSwitchTrack = { false: '#cbd5e1', true: GinitTheme.themeMainColor } as const;

function RowSep() {
  return <View style={styles.sep} />;
}

function SettingsRowLeadIcon({
  name,
  destructive,
}: {
  name: SymbolicIconName;
  destructive?: boolean;
}) {
  return (
    <View
      style={[styles.rowIconSlot, destructive && styles.rowIconSlotDanger]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <GinitSymbolicIcon name={name} size={22} color={destructive ? GinitTheme.colors.danger : '#475569'} />
    </View>
  );
}

function sectionTitle(label: string) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionHeadText}>{label}</Text>
    </View>
  );
}

function memoPreviewLine(memo: string): string {
  const t = memo.trim();
  if (!t) return '';
  const max = 48;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export default function FriendSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const editSheetScrollMaxH = useMemo(
    () => Math.min(Math.floor(windowHeight * 0.88), 580),
    [windowHeight],
  );
  const params = useLocalSearchParams<{ peerUserId?: string | string[] }>();
  const peerRaw = useMemo(() => {
    const raw = params.peerUserId;
    const v = Array.isArray(raw) ? (raw[0] ?? '') : typeof raw === 'string' ? raw : '';
    return decodeURIComponent(String(v)).trim();
  }, [params.peerUserId]);

  const { userId } = useUserSession();
  const me = useMemo(() => {
    const t = userId?.trim() ?? '';
    return t ? normalizeParticipantId(t) : '';
  }, [userId]);
  const peerNorm = useMemo(() => (peerRaw ? normalizeParticipantId(peerRaw) : ''), [peerRaw]);

  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [peerMemos, setPeerMemos] = useState<Record<string, string>>({});
  const [favorite, setFavorite] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [friendshipId, setFriendshipId] = useState<string | null>(null);
  const [relationAccepted, setRelationAccepted] = useState(false);
  const [busy, setBusy] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [modalAlias, setModalAlias] = useState('');
  const [modalMemo, setModalMemo] = useState('');
  /** Modal + KeyboardAvoidingView(padding) 조합은 키보드 닫힌 뒤 하단 공백이 남는 경우가 있어, inset 을 직접 동기화 */
  const [editKeyboardInset, setEditKeyboardInset] = useState(0);
  const editScrollRef = useRef<ScrollView>(null);
  const memoFieldFocusedRef = useRef(false);

  useEffect(() => {
    setEditOpen(false);
  }, [peerNorm]);

  useEffect(() => {
    if (!editOpen) {
      setEditKeyboardInset(0);
      return;
    }
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = Keyboard.addListener(showEvent, (e) => {
      const h = e.endCoordinates?.height;
      setEditKeyboardInset(typeof h === 'number' && Number.isFinite(h) ? Math.max(0, h) : 0);
    });
    const onHide = Keyboard.addListener(hideEvent, () => {
      setEditKeyboardInset(0);
    });
    return () => {
      onShow.remove();
      onHide.remove();
      setEditKeyboardInset(0);
    };
  }, [editOpen]);

  /** 키보드 높이가 반영된 뒤 메모·하단 버튼이 보이도록 스크롤(레이아웃 타이밍 대응) */
  const scrollNameMemoSheetToEnd = useCallback(() => {
    const tick = () => editScrollRef.current?.scrollToEnd({ animated: true });
    tick();
    requestAnimationFrame(tick);
    setTimeout(tick, 80);
    setTimeout(tick, 240);
  }, []);

  useEffect(() => {
    if (!editOpen) return;
    requestAnimationFrame(() => {
      editScrollRef.current?.scrollTo({ y: 0, animated: false });
    });
  }, [editOpen]);

  useEffect(() => {
    if (!editOpen || !memoFieldFocusedRef.current || editKeyboardInset <= 0) return;
    const id = setTimeout(() => editScrollRef.current?.scrollToEnd({ animated: true }), 40);
    return () => clearTimeout(id);
  }, [editKeyboardInset, editOpen]);

  const reload = useCallback(async () => {
    if (!me || !peerNorm) return;
    setProfile(undefined);
    try {
      const [p, al, mem, fav, hid, blk, rel] = await Promise.all([
        getUserProfile(peerNorm),
        loadFriendDisplayAliases(me),
        loadFriendPeerMemos(me),
        loadFavoritePeerKeys(me),
        loadHiddenPeerIds(me),
        loadBlockedPeerIds(me),
        fetchFriendRelationStatus(me, peerNorm).catch(() => ({ status: 'none' as const, friendship_id: null })),
      ]);
      setProfile(p ?? null);
      setAliases(al);
      setPeerMemos(mem);
      const pk = friendPeerStorageKey(peerNorm);
      setFavorite(pk ? fav.has(pk) : false);
      setHidden(pk ? hid.has(pk) : false);
      setBlocked(pk ? blk.has(pk) : false);
      const fid = typeof rel.friendship_id === 'string' ? rel.friendship_id.trim() : '';
      setFriendshipId(fid || null);
      setRelationAccepted(rel.status === 'accepted');
    } catch {
      setProfile(null);
    }
  }, [me, peerNorm]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const withdrawn = isUserProfileWithdrawn(profile ?? undefined);
  const officialNick = withdrawn ? WITHDRAWN_NICKNAME : (profile?.nickname?.trim() ?? '회원');
  const displayNick = friendDisplayName(aliases, peerNorm, officialNick);
  const memoSaved = friendPeerMemo(peerMemos, peerNorm);

  const openNameMemoEditor = useCallback(() => {
    const pk = friendPeerStorageKey(peerNorm);
    setModalAlias(pk ? (aliases[pk] ?? '') : '');
    setModalMemo(memoSaved);
    setEditOpen(true);
  }, [aliases, memoSaved, peerNorm]);

  const saveNameMemoFromModal = useCallback(async () => {
    if (!me || !peerNorm) return;
    setBusy(true);
    try {
      await saveFriendDisplayAlias(me, peerNorm, modalAlias);
      await saveFriendPeerMemo(me, peerNorm, modalMemo);
      const [al, mem] = await Promise.all([loadFriendDisplayAliases(me), loadFriendPeerMemos(me)]);
      setAliases(al);
      setPeerMemos(mem);
      setEditOpen(false);
      showTransientBottomMessage('이름과 메모를 저장했어요.');
    } catch {
      showTransientBottomMessage('저장에 실패했어요.');
    } finally {
      setBusy(false);
    }
  }, [me, peerNorm, modalAlias, modalMemo]);

  const syncFavoriteFromSwitch = useCallback(
    async (wantOn: boolean) => {
      if (!me || !peerNorm || busy) return;
      setBusy(true);
      const pk = friendPeerStorageKey(peerNorm);
      try {
        const s = await loadFavoritePeerKeys(me);
        const cur = s.has(pk);
        if (wantOn !== cur) {
          await toggleFavoritePeer(me, peerNorm);
        }
        const s2 = await loadFavoritePeerKeys(me);
        setFavorite(s2.has(pk));
      } finally {
        setBusy(false);
      }
    },
    [busy, me, peerNorm],
  );

  const onHide = useCallback(() => {
    if (!me || !peerNorm || busy) return;
    Alert.alert('숨기기', `${displayNick}님을 친구 목록에서 숨길까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '숨기기',
        onPress: () => {
          void (async () => {
            setBusy(true);
            try {
              const s = await loadHiddenPeerIds(me);
              s.add(friendPeerStorageKey(peerNorm));
              await saveHiddenPeerIds(me, s);
              setHidden(true);
              showTransientBottomMessage('목록에서 숨겼어요.');
              safeRouterBack(router);
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  }, [busy, displayNick, me, peerNorm, router]);

  const onBlock = useCallback(() => {
    if (!me || !peerNorm || busy) return;
    Alert.alert(
      '차단',
      `${displayNick}님을 차단할까요?\n친구 목록에서 보이지 않으며, 이후 상호작용이 제한될 수 있어요.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '차단',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                const pk = friendPeerStorageKey(peerNorm);
                const blockedSet = await loadBlockedPeerIds(me);
                blockedSet.add(pk);
                await saveBlockedPeerIds(me, blockedSet);
                try {
                  await blockPeerServerSynced(me, pk);
                } catch {
                  // 서버 동기화 실패 시에도 로컬은 유지(기존 UX 호환)
                }
                const hiddenSet = await loadHiddenPeerIds(me);
                hiddenSet.delete(pk);
                await saveHiddenPeerIds(me, hiddenSet);
                setBlocked(true);
                setHidden(false);
                showTransientBottomMessage('차단했어요.');
                safeRouterBack(router);
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [busy, displayNick, me, peerNorm, router]);

  const onDeleteFriend = useCallback(() => {
    if (!me || !peerNorm || busy) return;
    const fid = friendshipId?.trim() ?? '';
    if (!fid || !relationAccepted) {
      Alert.alert('알림', '수락된 친구 관계가 없어 삭제할 수 없어요.');
      return;
    }
    Alert.alert('친구 삭제', `${displayNick}님과의 지닛 친구 관계를 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy(true);
            try {
              await removeAcceptedFriend(me, fid);
              await saveFriendDisplayAlias(me, peerNorm, '');
              await saveFriendPeerMemo(me, peerNorm, '');
              const fav = await loadFavoritePeerKeys(me);
              fav.delete(friendPeerStorageKey(peerNorm));
              await saveFavoritePeerKeys(me, fav);
              showTransientBottomMessage('친구 관계를 삭제했어요.');
              safeRouterBack(router);
            } catch (e) {
              Alert.alert('삭제 실패', e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  }, [busy, displayNick, friendshipId, me, peerNorm, relationAccepted, router]);

  const onReport = useCallback(() => {
    Alert.alert('신고', `${displayNick}님을 신고할까요?\n운영 정책에 따라 검토합니다.`, [
      { text: '취소', style: 'cancel' },
      {
        text: '신고하기',
        style: 'destructive',
        onPress: () => {
          showTransientBottomMessage('신고가 접수되었어요. 검토 후 조치됩니다.');
        },
      },
    ]);
  }, [displayNick]);

  const memoPreview = memoPreviewLine(memoSaved);

  if (!me || !peerNorm) {
    return (
      <ScreenShell padded={false} style={styles.rootShell}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.topBar}>
            <Pressable onPress={() => safeRouterBack(router)} hitSlop={12} accessibilityRole="button" accessibilityLabel="뒤로" style={styles.backBtn}>
              <GinitSymbolicIcon name="chevron-back" size={22} color="#0f172a" />
            </Pressable>
            <Text style={styles.topTitle}>친구 설정</Text>
            <View style={styles.topBarSpacer} />
          </View>
          <View style={styles.centerMsg}>
            <Text style={styles.rowSub}>로그인이 필요해요.</Text>
          </View>
        </SafeAreaView>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell padded={false} style={styles.rootShell}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => safeRouterBack(router)} hitSlop={12} accessibilityRole="button" accessibilityLabel="뒤로" style={styles.backBtn}>
            <GinitSymbolicIcon name="chevron-back" size={22} color="#0f172a" />
          </Pressable>
          <Text style={styles.topTitle}>친구 설정</Text>
          <View style={styles.topBarSpacer} />
        </View>

        {profile === undefined ? (
          <View style={styles.centerMsg}>
            <ActivityIndicator color={GinitTheme.colors.primary} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.block}>
              {sectionTitle('이름')}
              <Pressable
                onPress={openNameMemoEditor}
                disabled={busy}
                style={({ pressed }) => [styles.row, styles.rowValignTop, pressed && styles.rowPressed, busy && styles.rowDisabled]}
                accessibilityRole="button"
                accessibilityLabel="이름 및 메모 편집">
                <SettingsRowLeadIcon name="pencil" />
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>표시 이름</Text>
                  <Text style={styles.rowSub}>공식 닉네임: {officialNick}</Text>
                  <Text style={styles.rowSubDisplay}>표시 이름: {displayNick}</Text>
                  {memoPreview ? (
                    <Text style={styles.rowSub} numberOfLines={2}>
                      메모: {memoPreview}
                    </Text>
                  ) : (
                    <Text style={styles.rowSub}>메모 없음 · 눌러서 작성</Text>
                  )}
                </View>
                <GinitSymbolicIcon name="chevron-forward" size={18} color={GinitTheme.colors.textMuted} />
              </Pressable>
            </View>

            <View style={[styles.block, styles.blockGap]}>
              {sectionTitle('관리')}
              <View style={styles.row}>
                <SettingsRowLeadIcon name="star" />
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>즐겨찾기</Text>
                  <Text style={styles.rowSub}>친구 목록에서 우선 보이게 해요.</Text>
                </View>
                <Switch
                  value={favorite}
                  onValueChange={(v) => void syncFavoriteFromSwitch(v)}
                  trackColor={meetingCreateSwitchTrack}
                  thumbColor={favorite ? '#FFFFFF' : '#f1f5f9'}
                  ios_backgroundColor="#cbd5e1"
                  disabled={busy}
                  accessibilityLabel="즐겨찾기"
                />
              </View>
              <RowSep />
              <Pressable
                onPress={onHide}
                disabled={busy || hidden}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed, (busy || hidden) && styles.rowDisabled]}
                accessibilityRole="button"
                accessibilityLabel="숨기기">
                <SettingsRowLeadIcon name="eye-off-outline" />
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>숨기기</Text>
                  <Text style={styles.rowSub}>{hidden ? '이미 목록에서 숨긴 상태예요.' : '친구 목록에서만 숨겨요.'}</Text>
                </View>
                {!hidden ? <GinitSymbolicIcon name="chevron-forward" size={18} color={GinitTheme.colors.textMuted} /> : null}
              </Pressable>
              <RowSep />
              <Pressable
                onPress={onBlock}
                disabled={busy || blocked}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed, (busy || blocked) && styles.rowDisabled]}
                accessibilityRole="button"
                accessibilityLabel="차단">
                <SettingsRowLeadIcon name="close-circle-outline" />
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>차단</Text>
                  <Text style={styles.rowSub}>{blocked ? '이미 차단한 상태예요.' : '목록·상호작용에서 제외해요.'}</Text>
                </View>
                {!blocked ? <GinitSymbolicIcon name="chevron-forward" size={18} color={GinitTheme.colors.textMuted} /> : null}
              </Pressable>
              <RowSep />
              <Pressable
                onPress={onDeleteFriend}
                disabled={busy}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed, busy && styles.rowDisabled]}
                accessibilityRole="button"
                accessibilityLabel="친구 삭제">
                <SettingsRowLeadIcon name="trash-outline" destructive />
                <View style={styles.rowText}>
                  <Text style={[styles.rowLabel, styles.rowLabelDanger]}>친구 삭제</Text>
                  <Text style={[styles.rowSub, styles.rowSubDanger]}>지닛 친구 관계만 삭제돼요.</Text>
                </View>
                <GinitSymbolicIcon name="chevron-forward" size={18} color={GinitTheme.colors.danger} />
              </Pressable>
              <RowSep />
              <Pressable
                onPress={onReport}
                disabled={busy}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed, busy && styles.rowDisabled]}
                accessibilityRole="button"
                accessibilityLabel="신고">
                <SettingsRowLeadIcon name="shield-checkmark-outline" destructive />
                <View style={styles.rowText}>
                  <Text style={[styles.rowLabel, styles.rowLabelDanger]}>신고</Text>
                  <Text style={[styles.rowSub, styles.rowSubDanger]}>부적절한 이용 등을 운영에 알려요.</Text>
                </View>
                <GinitSymbolicIcon name="chevron-forward" size={18} color={GinitTheme.colors.textMuted} />
              </Pressable>
            </View>
          </ScrollView>
        )}

        <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => !busy && setEditOpen(false)}>
          <View style={styles.editModalRoot}>
            <Pressable style={styles.editModalDim} onPress={() => !busy && setEditOpen(false)} accessibilityRole="button" accessibilityLabel="닫기" />
            <View style={styles.editKavWrap} pointerEvents="box-none">
              <View style={styles.editKav}>
                <ScrollView
                  ref={editScrollRef}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator
                  bounces={false}
                  automaticallyAdjustKeyboardInsets={false}
                  style={[styles.editScroll, { maxHeight: editSheetScrollMaxH }]}
                  contentContainerStyle={styles.editScrollContent}>
                  <View style={[styles.editPanel, { paddingBottom: Math.max(insets.bottom, 16) + editKeyboardInset }]}>
                    <Text style={styles.editTitle}>이름 및 메모</Text>
                    <Text style={styles.editLead}>내 기기에만 저장되며 상대에게 전달되지 않아요.</Text>

                    <Text style={styles.editFieldLabel}>공식 닉네임</Text>
                    <Text style={styles.editReadonly}>{officialNick}</Text>

                    <Text style={styles.editFieldLabel}>표시 이름</Text>
                    <TextInput
                      value={modalAlias}
                      onChangeText={setModalAlias}
                      placeholder={officialNick}
                      placeholderTextColor={GinitTheme.colors.textMuted}
                      style={styles.editInput}
                      maxLength={DISPLAY_NAME_MAX_LEN}
                      returnKeyType="next"
                      accessibilityLabel="표시 이름 입력"
                    />
                    <Text style={styles.editHint}>비워 두면 공식 닉네임이 그대로 표시돼요.</Text>

                    <Text style={styles.editFieldLabel}>메모</Text>
                    <TextInput
                      value={modalMemo}
                      onChangeText={setModalMemo}
                      placeholder="이 친구에 대한 메모를 적어 보세요."
                      placeholderTextColor={GinitTheme.colors.textMuted}
                      style={styles.editMemoInput}
                      maxLength={MEMO_MAX_LEN}
                      multiline
                      textAlignVertical="top"
                      accessibilityLabel="메모 입력"
                      onFocus={() => {
                        memoFieldFocusedRef.current = true;
                        scrollNameMemoSheetToEnd();
                      }}
                      onBlur={() => {
                        memoFieldFocusedRef.current = false;
                      }}
                    />

                    <View style={styles.editActions}>
                      <Pressable
                        onPress={() => !busy && setEditOpen(false)}
                        style={({ pressed }) => [styles.editBtnGhost, pressed && { opacity: 0.88 }]}
                        accessibilityRole="button"
                        accessibilityLabel="취소">
                        <Text style={styles.editBtnGhostText}>취소</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void saveNameMemoFromModal()}
                        disabled={busy}
                        style={({ pressed }) => [styles.editBtnPrimary, (pressed && !busy) && { opacity: 0.88 }, busy && { opacity: 0.55 }]}
                        accessibilityRole="button"
                        accessibilityLabel="저장">
                        <Text style={styles.editBtnPrimaryText}>{busy ? '저장 중…' : '저장'}</Text>
                      </Pressable>
                    </View>
                  </View>
                </ScrollView>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  rootShell: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  safe: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 48,
  },
  backBtn: { padding: 4 },
  topTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: '#0f172a' },
  topBarSpacer: { width: 30 },
  scroll: { paddingTop: 8, paddingBottom: 32 },
  block: { backgroundColor: 'transparent' },
  blockGap: { marginTop: 20 },
  sectionHead: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    paddingTop: 4,
  },
  sectionHeadText: {
    fontSize: 13,
    fontWeight: '700',
    color: GinitTheme.colors.textMuted,
    letterSpacing: -0.1,
  },
  rowIconSlot: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconSlotDanger: { backgroundColor: 'rgba(220, 38, 38, 0.08)' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 12,
  },
  rowValignTop: { alignItems: 'flex-start' },
  rowPressed: { opacity: 0.82 },
  rowDisabled: { opacity: 0.55 },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 16, fontWeight: '400', color: GinitTheme.colors.text, letterSpacing: -0.2 },
  rowLabelDanger: { color: '#b91c1c' },
  rowSub: { marginTop: 4, fontSize: 12, fontWeight: '400', color: GinitTheme.colors.textMuted, lineHeight: 16 },
  rowSubDisplay: { marginTop: 4, fontSize: 13, fontWeight: '600', color: GinitTheme.colors.text, lineHeight: 18, letterSpacing: -0.15 },
  rowSubDanger: { color: '#991b1b' },
  sep: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 20,
    backgroundColor: GinitTheme.colors.border,
  },
  centerMsg: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },

  editModalRoot: { flex: 1 },
  editModalDim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.45)' },
  editKavWrap: {
    flex: 1,
    justifyContent: 'flex-end',
    zIndex: 1,
  },
  editKav: { width: '100%' },
  editScroll: { width: '100%' },
  /** flexGrow: 1 은 스크롤 콘텐츠 높이를 뷰에 맞춰 늘려 메모 영역이 스크롤되지 않는 경우가 있음 */
  editScrollContent: {},
  editPanel: {
    backgroundColor: GinitTheme.colors.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  editTitle: { fontSize: 18, fontWeight: '700', color: GinitTheme.colors.text, letterSpacing: -0.2 },
  editLead: { marginTop: 6, fontSize: 13, fontWeight: '400', color: GinitTheme.colors.textMuted, lineHeight: 18 },
  editFieldLabel: { marginTop: 16, fontSize: 13, fontWeight: '700', color: GinitTheme.colors.textSub, letterSpacing: -0.1 },
  editReadonly: { marginTop: 6, fontSize: 16, fontWeight: '400', color: GinitTheme.colors.text, letterSpacing: -0.2 },
  editInput: {
    marginTop: 8,
    fontSize: 16,
    fontWeight: '400',
    color: GinitTheme.colors.text,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GinitTheme.colors.border,
  },
  editHint: { marginTop: 6, fontSize: 12, color: GinitTheme.colors.textMuted, lineHeight: 16 },
  editMemoInput: {
    marginTop: 8,
    minHeight: 120,
    maxHeight: 220,
    fontSize: 15,
    fontWeight: '400',
    color: GinitTheme.colors.text,
    lineHeight: 22,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    borderRadius: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.03)',
  },
  editActions: {
    marginTop: 20,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  editBtnGhost: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    backgroundColor: GinitTheme.colors.bg,
  },
  editBtnGhostText: { fontSize: 15, fontWeight: '700', color: GinitTheme.colors.textSub },
  editBtnPrimary: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: GinitTheme.colors.primary,
  },
  editBtnPrimaryText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
