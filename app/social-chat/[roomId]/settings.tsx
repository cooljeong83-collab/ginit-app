
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { type ComponentProps, useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MeetingPeerProfileModal } from '@/components/meeting/MeetingPeerProfileModal';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { getSocialChatImageUploadQuality, setSocialChatImageUploadQuality } from '@/src/lib/social-chat-image-quality-preference';
import { getSocialChatNotifyEnabledForUser, setSocialChatNotifyEnabledForUser } from '@/src/lib/social-chat-notify-preference';
import { parsePeerFromSocialRoomId } from '@/src/lib/social-chat-rooms';
import type { UserProfile } from '@/src/lib/user-profile';
import { getUserProfilesForIds, isUserProfileWithdrawn } from '@/src/lib/user-profile';
import { GinitSymbolicIcon, type SymbolicIconName } from '@/components/ui/GinitSymbolicIcon';

type IonIconName = SymbolicIconName;

function SettingsRowIcon({ name, destructive }: { name: IonIconName; destructive?: boolean }) {
  return (
    <View
      style={[styles.rowIconSlot, destructive && styles.rowIconSlotDanger]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <GinitSymbolicIcon name={name} size={22} color={destructive ? '#dc2626' : '#475569'} />
    </View>
  );
}

function SettingsRowChevron({
  icon,
  label,
  sub,
  onPress,
  destructive,
}: {
  icon: IonIconName;
  label: string;
  sub?: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} accessibilityRole="button">
      <SettingsRowIcon name={icon} destructive={destructive} />
      <View style={styles.rowTextCol}>
        <Text style={[styles.rowLabel, destructive && styles.rowLabelDanger]}>{label}</Text>
        {sub ? (
          <Text style={[styles.rowSub, destructive && styles.rowSubDanger]} numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
      </View>
      <GinitSymbolicIcon name="chevron-forward" size={18} color={destructive ? '#f87171' : '#94a3b8'} />
    </Pressable>
  );
}

function profileFor(map: Map<string, UserProfile>, appUserId: string): UserProfile | undefined {
  const n = normalizeParticipantId(appUserId);
  const hit = map.get(appUserId) ?? map.get(n);
  if (hit) return hit;
  for (const [k, v] of map) {
    if (normalizeParticipantId(k) === n) return v;
  }
  return undefined;
}

export default function SocialChatSettingsScreen() {
  const router = useRouter();
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
  const [notifyOn, setNotifyOn] = useState(true);
  const [notifyLoaded, setNotifyLoaded] = useState(false);
  const [imageHighQuality, setImageHighQuality] = useState(false);
  const [imageQualityLoaded, setImageQualityLoaded] = useState(false);
  const [peerProfileUserId, setPeerProfileUserId] = useState<string | null>(null);

  const myNorm = userId?.trim() ? normalizeParticipantId(userId.trim()) : '';
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

  useEffect(() => {
    if (!roomId) return;
    const uid = userId?.trim() ?? '';
    if (!uid) return;
    let cancelled = false;
    void (async () => {
      try {
        const v = await getSocialChatNotifyEnabledForUser(roomId, uid);
        if (cancelled) return;
        setNotifyOn(v);
      } catch {
        /* noop */
      } finally {
        if (!cancelled) setNotifyLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId, userId]);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    void (async () => {
      try {
        const q = await getSocialChatImageUploadQuality(roomId);
        if (cancelled) return;
        setImageHighQuality(q === 'high');
      } catch {
        /* noop */
      } finally {
        if (!cancelled) setImageQualityLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  const onToggleNotify = useCallback(async (next: boolean) => {
    setNotifyOn(next);
    if (!roomId) return;
    try {
      const uid = userId?.trim() ?? '';
      if (!uid) return;
      await setSocialChatNotifyEnabledForUser(roomId, uid, next);
    } catch {
      setNotifyOn((prev) => !prev);
    }
  }, [roomId, userId]);

  const onToggleImageQuality = useCallback(async (high: boolean) => {
    setImageHighQuality(high);
    if (!roomId) return;
    await setSocialChatImageUploadQuality(roomId, high ? 'high' : 'low');
  }, [roomId]);

  const onBack = useCallback(() => {
    router.back();
  }, [router]);

  const openChatPhotos = useCallback(() => {
    router.push(`/social-chat/${encodeURIComponent(roomId)}/media?peerName=${encodeURIComponent(peerName)}`);
  }, [router, roomId, peerName]);

  const openPeerProfileInfo = useCallback(() => {
    const pid = peerId.trim();
    if (!pid) {
      Alert.alert('프로필', '상대 프로필을 불러올 수 없어요.');
      return;
    }
    setPeerProfileUserId(pid);
  }, [peerId]);

  const openLeaveInfo = useCallback(() => {
    Alert.alert('채팅방 나가기', '1:1 채팅 나가기(숨기기/차단 포함)는 준비 중이에요. 곧 연결할게요.');
  }, []);

  if (!roomId) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <Text style={styles.muted}>잘못된 주소예요.</Text>
      </SafeAreaView>
    );
  }

  const myProfile = myNorm ? profileFor(profiles, myNorm) : undefined;
  const myNick = isUserProfileWithdrawn(myProfile) ? '회원' : (myProfile?.nickname ?? '회원');
  const peerProfile = peerId.trim() ? profileFor(profiles, peerId.trim()) : undefined;
  const peerNick = peerProfile ? (isUserProfileWithdrawn(peerProfile) ? '회원' : (peerProfile.nickname ?? peerName)) : peerName;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="뒤로">
          <GinitSymbolicIcon name="chevron-back" size={22} color="#0f172a" />
        </Pressable>
        <Text style={styles.headerTitle}>채팅방 설정</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <GinitSymbolicIcon name="chatbubbles" size={28} color={GinitTheme.colors.primary} />
          </View>
          <Text style={styles.heroTitle} numberOfLines={2}>
            {peerName}
          </Text>
          <Text style={styles.heroSub}>1:1 대화</Text>
        </View>

        <View style={styles.card}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.avatarStrip}>
            <View style={styles.avatarItem} accessibilityRole="text" accessibilityLabel={myNick}>
              <View style={styles.avatarRing}>
                {myProfile?.photoUrl ? (
                  <Image source={{ uri: myProfile.photoUrl }} style={styles.avatarImg} contentFit="cover" />
                ) : (
                  <Text style={styles.avatarLetter}>{myNick.slice(0, 1)}</Text>
                )}
              </View>
              <Text style={styles.avatarNick} numberOfLines={1}>
                {myNick}
              </Text>
            </View>
            <Pressable
              style={styles.avatarItem}
              disabled={!peerId.trim() || isUserProfileWithdrawn(peerProfile)}
              onPress={() => peerId.trim() && setPeerProfileUserId(peerId.trim())}
              accessibilityRole={peerId.trim() ? 'button' : 'text'}
              accessibilityLabel={peerNick}>
              <View style={styles.avatarRing}>
                {peerProfile?.photoUrl ? (
                  <Image source={{ uri: peerProfile.photoUrl }} style={styles.avatarImg} contentFit="cover" />
                ) : (
                  <Text style={styles.avatarLetter}>{peerNick.slice(0, 1)}</Text>
                )}
              </View>
              <Text style={styles.avatarNick} numberOfLines={1}>
                {peerNick}
              </Text>
            </Pressable>
          </ScrollView>
          <View style={styles.cardDivider} />
          <SettingsRowChevron icon="person-outline" label="상대 프로필" sub="gTrust · gDna" onPress={openPeerProfileInfo} />
          <View style={styles.cardDivider} />
          <SettingsRowChevron icon="images-outline" label="사진" sub="이 채팅방에서 주고받은 사진" onPress={openChatPhotos} />
        </View>

        <View style={styles.card}>
          <View style={styles.row}>
            <SettingsRowIcon name="notifications-outline" />
            <View style={styles.rowTextCol}>
              <Text style={styles.rowLabel}>알림</Text>
              <Text style={styles.rowSub}>이 1:1 채팅 알림(로컬 배너·푸시)</Text>
            </View>
            {notifyLoaded ? (
              <Switch
                value={notifyOn}
                onValueChange={(v) => void onToggleNotify(v)}
                trackColor={{ false: '#cbd5e1', true: 'rgba(31, 42, 68, 0.35)' }}
                thumbColor={notifyOn ? GinitTheme.colors.primary : '#f1f5f9'}
                accessibilityLabel="채팅 알림"
              />
            ) : (
              <ActivityIndicator size="small" color="#94a3b8" />
            )}
          </View>
          <View style={styles.cardDividerIndented} />
          <View style={styles.row}>
            <SettingsRowIcon name="image-outline" />
            <View style={styles.rowTextCol}>
              <Text style={styles.rowLabel}>고화질로 사진 보내기</Text>
              <Text style={styles.rowSub}>기본은 저화질(최대한 압축)이고, 켜면 더 선명하게 보낼 수 있어요.</Text>
            </View>
            {imageQualityLoaded ? (
              <Switch
                value={imageHighQuality}
                onValueChange={(v) => void onToggleImageQuality(v)}
                trackColor={{ false: '#cbd5e1', true: 'rgba(31, 42, 68, 0.35)' }}
                thumbColor={imageHighQuality ? GinitTheme.colors.primary : '#f1f5f9'}
                accessibilityLabel="고화질 사진 전송"
              />
            ) : (
              <ActivityIndicator size="small" color="#94a3b8" />
            )}
          </View>
        </View>

        <View style={styles.card}>
          <SettingsRowChevron
            icon="log-out-outline"
            label="채팅방 나가기"
            sub="준비 중 (숨기기/차단으로 제공 예정)"
            onPress={openLeaveInfo}
            destructive
          />
        </View>
      </ScrollView>
      <MeetingPeerProfileModal
        visible={peerProfileUserId != null}
        peerAppUserId={peerProfileUserId}
        onClose={() => setPeerProfileUserId(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f2f4f7' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  muted: { fontSize: 14, color: '#64748b', fontWeight: '600' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: '#f2f4f7',
  },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#0f172a', letterSpacing: -0.3 },
  scroll: { paddingBottom: 32, paddingTop: 4 },
  heroCard: {
    marginHorizontal: 16,
    marginBottom: 20,
    paddingVertical: 22,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#fff',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.06)',
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: 'rgba(31, 42, 68, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0f172a',
    textAlign: 'center',
    letterSpacing: -0.4,
    marginBottom: 6,
  },
  heroSub: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  card: {
    marginHorizontal: 16,
    marginBottom: 18,
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.06)',
  },
  avatarStrip: { paddingVertical: 14, paddingHorizontal: 12, gap: 14, flexDirection: 'row', alignItems: 'flex-start' },
  avatarItem: { width: 56, alignItems: 'center' },
  avatarRing: {
    width: 48,
    height: 48,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(0, 82, 204, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: { width: 48, height: 48 },
  avatarLetter: { fontSize: 18, fontWeight: '600', color: '#0052CC' },
  avatarNick: { marginTop: 6, fontSize: 11, fontWeight: '700', color: '#475569', maxWidth: 56, textAlign: 'center' },
  cardDivider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(15, 23, 42, 0.08)', marginLeft: 16 },
  /** 아이콘(36) + gap(12) + 좌 패딩(16) — 텍스트 시작선에 맞춤 */
  cardDividerIndented: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(15, 23, 42, 0.08)',
    marginLeft: 64,
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
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  rowPressed: { backgroundColor: 'rgba(15, 23, 42, 0.03)' },
  rowTextCol: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 15, fontWeight: '600', color: '#0f172a', letterSpacing: -0.15 },
  rowSub: { marginTop: 4, fontSize: 12, fontWeight: '600', color: '#64748b', lineHeight: 16 },
  rowLabelDanger: { color: '#dc2626' },
  rowSubDanger: { color: '#f87171' },
});

