import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { UserProfilePublicBody } from '@/components/profile/UserProfilePublicBody';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { showTransientBottomMessage } from '@/components/ui/TransientBottomMessage';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { safeRouterBack } from '@/src/lib/router-safe';

const TOP_BAR_HEIGHT = 45;
const MORE_MENU_GAP = 0;

export default function UserProfileStackScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useUserSession();
  const [moreOpen, setMoreOpen] = useState(false);
  const params = useLocalSearchParams<{ userId?: string | string[] }>();
  const targetUserId = useMemo(() => {
    const raw = params.userId;
    const v = Array.isArray(raw) ? (raw[0] ?? '') : typeof raw === 'string' ? raw : '';
    return decodeURIComponent(String(v)).trim();
  }, [params.userId]);

  const meNorm = useMemo(() => {
    const t = userId?.trim() ?? '';
    return t ? normalizeParticipantId(t) : '';
  }, [userId]);
  const targetNorm = useMemo(
    () => (targetUserId.trim() ? normalizeParticipantId(targetUserId.trim()) : ''),
    [targetUserId],
  );
  const showPeerMoreMenu = Boolean(
    meNorm && targetNorm && meNorm !== targetNorm && targetNorm !== 'ginit_ai',
  );

  const openFriendSettings = () => {
    setMoreOpen(false);
    router.push(`/profile/friend-settings/${encodeURIComponent(targetNorm)}`);
  };

  const openReportFromMenu = () => {
    setMoreOpen(false);
    Alert.alert('신고', '이 사용자를 신고할까요?\n운영 정책에 따라 검토합니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '신고하기',
        style: 'destructive',
        onPress: () => {
          showTransientBottomMessage('신고가 접수되었어요. 검토 후 조치됩니다.');
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => safeRouterBack(router)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="뒤로"
          style={styles.backBtn}>
          <GinitSymbolicIcon name="chevron-back" size={22} color="#0f172a" />
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>
          프로필
        </Text>
        {showPeerMoreMenu ? (
          <Pressable
            onPress={() => setMoreOpen(true)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="더보기"
            style={styles.moreBtn}>
            <GinitSymbolicIcon name="ellipsis-vertical" size={22} color="#0f172a" />
          </Pressable>
        ) : (
          <View style={styles.topBarSpacer} />
        )}
      </View>

      <Modal visible={moreOpen} transparent animationType="fade" onRequestClose={() => setMoreOpen(false)}>
        <View style={styles.moreModalRoot}>
          <Pressable style={styles.moreDim} onPress={() => setMoreOpen(false)} accessibilityRole="button" accessibilityLabel="닫기" />
          <View
            style={[
              styles.moreSheet,
              {
                top: insets.top + TOP_BAR_HEIGHT + MORE_MENU_GAP,
                right: 28,
              },
            ]}>
            <Pressable
              onPress={openFriendSettings}
              style={({ pressed }) => [styles.moreRow, pressed && { opacity: 0.88 }]}
              accessibilityRole="button"
              accessibilityLabel="친구 설정">
              <Text style={styles.moreRowText}>친구 설정</Text>
            </Pressable>
            <View style={styles.moreSep} />
            <Pressable
              onPress={openReportFromMenu}
              style={({ pressed }) => [styles.moreRow, pressed && { opacity: 0.88 }]}
              accessibilityRole="button"
              accessibilityLabel="신고">
              <Text style={styles.moreRowText}>신고</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {targetUserId ? (
          <UserProfilePublicBody targetUserId={targetUserId} layout="stack" />
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>프로필을 찾을 수 없어요.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    height: 52,
  },
  backBtn: { padding: 4 },
  topTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: '#0f172a' },
  topBarSpacer: { width: 44, height: 1 },
  moreBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  moreModalRoot: { flex: 1 },
  moreDim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.35)' },
  moreSheet: {
    position: 'absolute',
    minWidth: 200,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    overflow: 'hidden',
  },
  moreRow: { paddingVertical: 14, paddingHorizontal: 16 },
  moreRowText: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  moreSep: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(15, 23, 42, 0.1)' },

  scroll: { paddingBottom: 24 },
  empty: { padding: 20 },
  emptyText: { fontSize: 14, fontWeight: '700', color: '#64748b' },
});

